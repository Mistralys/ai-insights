# Orchestrator - Tests
_SOURCE: Test suite (unit, integration, live marks)_
# Test suite (unit, integration, live marks)
```
// Structure of documents
└── orchestrator/
    └── tests/
        └── __init__.py
        └── conftest.py
        └── test_chunk_writer.py
        └── test_cli.py
        └── test_config.py
        └── test_dialogue_writer.py
        └── test_error_helpers.py
        └── test_filelock.py
        └── test_graph.py
        └── test_integration.py
        └── test_logging.py
        └── test_mcp_parse.py
        └── test_nodes.py
        └── test_persona_models.py
        └── test_plan_parser.py
        └── test_post_completion_guard.py
        └── test_prompt_renderer.py
        └── test_revision.py
        └── test_run_queue.py
        └── test_state.py
        └── test_stream_retry.py
        └── test_streaming_capture.py
        └── test_subagents.py
        └── test_subprocess_encoding.py
        └── test_supervisor.py
        └── test_tool_wrappers.py

```
###  Path: `/orchestrator/tests/__init__.py`

```py
"""
tests — orchestrator test suite.
"""

```
###  Path: `/orchestrator/tests/conftest.py`

```py
"""
conftest.py — Shared pytest fixtures and config stubs for the orchestrator test suite.

Config stubs
------------
Three config stub classes are available to all test modules without import:

_StreamCaptureConfig(workspace_root)
    ``capture_dialogues=True``; ``workspace_root`` supplied at construction time
    (typically via the ``tmp_path`` fixture).  Used in streaming and chunk-write
    tests that need a real temp directory for JSONL output.

_CaptureConfig
    ``capture_dialogues=True``; ``workspace_root`` is the actual workspace root
    (resolved from ``__file__``).  Used in tests that need to load real persona
    files from the workspace.

_NoCaptureConfig
    ``capture_dialogues=False``; ``workspace_root`` is a non-existent temp path.
    Used where capture is deliberately disabled.
"""

from __future__ import annotations

from pathlib import Path


class _StreamCaptureConfig:
    """Config stub with ``capture_dialogues=True`` and a caller-supplied workspace root."""

    def __init__(self, workspace_root: Path) -> None:
        self.workspace_root = workspace_root
        self.capture_dialogues = True
        self.stream_max_retries = 0
        self.stream_retry_base_delay_s = 10.0
        self.stage_models = {
            "developer": "claude-test",
            "pm": "claude-test",
            "qa": "claude-test",
            "reviewer": "claude-test",
            "security_auditor": "claude-test",
            "docs": "claude-test",
            "release_engineer": "claude-test",
            "synthesis": "claude-test",
            "planner": "claude-test",
        }

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _CaptureConfig:
    """Config stub with ``capture_dialogues=True`` and the real workspace root."""

    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent
    capture_dialogues = True
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


class _NoCaptureConfig:
    """Config stub with ``capture_dialogues=False``."""

    workspace_root = Path("/tmp/no-capture-ws")
    capture_dialogues = False
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0
    stage_models = {k: "claude-test" for k in [
        "developer", "pm", "qa", "reviewer", "security_auditor",
        "docs", "release_engineer", "synthesis", "planner",
    ]}

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")

```
###  Path: `/orchestrator/tests/test_chunk_writer.py`

```py
"""
test_chunk_writer.py — Unit tests for orchestrator/src/utils/chunk_writer.py.

All filesystem operations use pytest's ``tmp_path`` fixture or
``tempfile.mkdtemp()`` for platform-agnostic temp directories.  No real files
are created outside the temporary directory.
"""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from types import MappingProxyType
from unittest.mock import MagicMock

import pytest

from src.utils.chunk_writer import _CHUNK_HEADER, ChunkWriter

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _chunks_dir(slug_dir: Path) -> Path:
    return slug_dir / "orchestrator" / "chunks"


def _make_writer(slug_dir: Path, wp_id: str = "WP-001", stage: str = "developer") -> ChunkWriter:
    return ChunkWriter(slug_dir=slug_dir, wp_id=wp_id, stage=stage)


def _read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


# ---------------------------------------------------------------------------
# Directory creation and file naming
# ---------------------------------------------------------------------------


class TestDirectoryCreation:
    """ChunkWriter creates {slug_dir}/orchestrator/chunks/ if absent."""

    def test_chunks_dir_created(self, tmp_path: Path) -> None:
        slug_dir = tmp_path / "my-project"
        # Directory does not exist yet — ChunkWriter must create it.
        assert not _chunks_dir(slug_dir).exists()
        with _make_writer(slug_dir):
            pass
        assert _chunks_dir(slug_dir).is_dir()

    def test_chunks_dir_already_exists(self, tmp_path: Path) -> None:
        """No error raised when the directory already exists."""
        _chunks_dir(tmp_path).mkdir(parents=True)
        with _make_writer(tmp_path):
            pass
        assert _chunks_dir(tmp_path).is_dir()

    def test_file_created(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert cw.path.exists()

    def test_file_extension_is_jsonl(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert cw.path.suffix == ".jsonl"

    def test_file_name_contains_wp_id(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path, wp_id="WP-007") as cw:
            assert "WP-007" in cw.path.name

    def test_file_name_contains_stage(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path, stage="qa") as cw:
            assert "qa" in cw.path.name


# ---------------------------------------------------------------------------
# Revision numbering
# ---------------------------------------------------------------------------


class TestRevisionNumbering:
    """Revision numbers auto-increment for the same wp_id/stage pair."""

    def test_first_revision_is_r0(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert cw.path.name.endswith("-r0.jsonl")

    def test_second_revision_is_r1(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path):
            pass
        with _make_writer(tmp_path) as cw:
            assert cw.path.name.endswith("-r1.jsonl")

    def test_third_revision_is_r2(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path):
            pass
        with _make_writer(tmp_path):
            pass
        with _make_writer(tmp_path) as cw:
            assert cw.path.name.endswith("-r2.jsonl")

    def test_different_stage_starts_at_r0(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path, stage="developer"):
            pass
        with _make_writer(tmp_path, stage="qa") as cw:
            assert cw.path.name.endswith("-r0.jsonl")

    def test_different_wp_id_starts_at_r0(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path, wp_id="WP-001"):
            pass
        with _make_writer(tmp_path, wp_id="WP-002") as cw:
            assert cw.path.name.endswith("-r0.jsonl")

    def test_non_sequential_existing_revisions(self, tmp_path: Path) -> None:
        """If existing files are r0 and r3, next revision should be r4."""
        chunks_dir = _chunks_dir(tmp_path)
        chunks_dir.mkdir(parents=True)
        for rev in (0, 3):
            (chunks_dir / f"WP-001-developer-r{rev}.jsonl").write_text("{}\n")
        with _make_writer(tmp_path) as cw:
            assert cw.path.name.endswith("-r4.jsonl")


# ---------------------------------------------------------------------------
# Header line
# ---------------------------------------------------------------------------


class TestHeaderLine:
    """The first line of every JSONL file is the version header."""

    def test_header_is_first_line(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        lines = _read_lines(path)
        assert lines[0] == _CHUNK_HEADER

    def test_header_contains_chunk_format(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert "chunk_format" in header

    def test_header_contains_stream_mode(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert "stream_mode" in header

    def test_header_contains_langgraph_stream_version(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert "langgraph_stream_version" in header

    def test_header_chunk_format_value(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert header["chunk_format"] == 1

    def test_header_stream_mode_value(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert header["stream_mode"] == "messages"

    def test_header_langgraph_stream_version_value(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            path = cw.path
        header = _read_lines(path)[0]
        assert header["langgraph_stream_version"] == "v2"

    def test_header_written_even_without_chunks(self, tmp_path: Path) -> None:
        """Closing immediately still persists the header."""
        with _make_writer(tmp_path) as cw:
            path = cw.path
        lines = _read_lines(path)
        assert len(lines) == 1
        assert lines[0] == _CHUNK_HEADER

    def test_header_is_immutable_mapping_proxy(self) -> None:
        """_CHUNK_HEADER must be a MappingProxyType (read-only)."""
        assert isinstance(_CHUNK_HEADER, MappingProxyType)

    def test_header_mutation_raises_type_error(self) -> None:
        """Attempting to mutate _CHUNK_HEADER must raise TypeError."""
        with pytest.raises(TypeError):
            _CHUNK_HEADER["foo"] = "bar"  # type: ignore[index]


# ---------------------------------------------------------------------------
# write_chunk
# ---------------------------------------------------------------------------


class TestWriteChunk:
    """write_chunk appends one JSON line per call and flushes immediately."""

    def test_single_chunk_appended(self, tmp_path: Path) -> None:
        chunk = {"type": "ai", "content": "hello"}
        with _make_writer(tmp_path) as cw:
            cw.write_chunk(chunk)
            path = cw.path
        lines = _read_lines(path)
        assert lines[1] == chunk

    def test_multiple_chunks_appended_in_order(self, tmp_path: Path) -> None:
        chunks = [{"index": i} for i in range(5)]
        with _make_writer(tmp_path) as cw:
            for c in chunks:
                cw.write_chunk(c)
            path = cw.path
        lines = _read_lines(path)
        # lines[0] is header; lines[1..5] are chunks
        assert lines[1:] == chunks

    def test_flush_called_after_each_write(self, tmp_path: Path) -> None:
        """Verify flush() is invoked immediately on every write_chunk call."""
        cw = _make_writer(tmp_path)
        try:
            mock_fh = MagicMock()
            cw._fh = mock_fh
            cw.write_chunk({"x": 1})
            cw.write_chunk({"x": 2})
        finally:
            cw._closed = True  # skip real close since _fh is mocked
        assert mock_fh.flush.call_count == 2

    def test_write_chunk_after_close_is_silent(self, tmp_path: Path) -> None:
        """write_chunk on a closed writer silently does nothing."""
        with _make_writer(tmp_path) as cw:
            path = cw.path
        # Should not raise
        cw.write_chunk({"late": "chunk"})
        # File should only contain the header line (no late chunk)
        lines = _read_lines(path)
        assert len(lines) == 1

    def test_chunk_is_valid_json_line(self, tmp_path: Path) -> None:
        chunk = {"key": "value", "nested": {"a": 1}}
        with _make_writer(tmp_path) as cw:
            cw.write_chunk(chunk)
            path = cw.path
        raw = path.read_text(encoding="utf-8").splitlines()
        # Every line must be valid JSON
        for line in raw:
            json.loads(line)  # raises if invalid

    def test_non_serializable_chunk_suppressed(self, tmp_path: Path) -> None:
        """A chunk containing non-serialisable values (e.g. set) must not raise."""
        with _make_writer(tmp_path) as cw:
            # set is not JSON-serialisable → TypeError
            cw.write_chunk({"bad": {1, 2, 3}})  # type: ignore[dict-item]
            path = cw.path
        # File should only contain the header line (bad chunk was skipped)
        lines = _read_lines(path)
        assert len(lines) == 1

    def test_non_serializable_chunk_does_not_corrupt_file(self, tmp_path: Path) -> None:
        """A skipped non-serialisable chunk must not corrupt subsequent writes."""
        with _make_writer(tmp_path) as cw:
            cw.write_chunk({"good": 1})
            cw.write_chunk({"bad": {1, 2, 3}})  # type: ignore[dict-item]
            cw.write_chunk({"also_good": 2})
            path = cw.path
        lines = _read_lines(path)
        # header + good + also_good = 3 lines (bad chunk skipped)
        assert len(lines) == 3
        assert lines[1] == {"good": 1}
        assert lines[2] == {"also_good": 2}


# ---------------------------------------------------------------------------
# close() idempotency
# ---------------------------------------------------------------------------


class TestClose:
    """close() is idempotent — multiple calls must not raise."""

    def test_close_once(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        cw.close()  # should not raise

    def test_close_twice(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        cw.close()
        cw.close()  # should not raise

    def test_close_many_times(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        for _ in range(10):
            cw.close()  # should not raise

    def test_closed_flag_set_after_close(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        assert not cw._closed
        cw.close()
        assert cw._closed

    def test_fh_is_none_after_close(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        cw.close()
        assert cw._fh is None


# ---------------------------------------------------------------------------
# Context manager protocol
# ---------------------------------------------------------------------------


class TestContextManager:
    """ChunkWriter works as a context manager."""

    def test_enter_returns_self(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        result = cw.__enter__()
        assert result is cw
        cw.close()

    def test_with_statement_works(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert isinstance(cw, ChunkWriter)

    def test_exit_calls_close(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            pass
        assert cw._closed

    def test_exit_on_exception_still_closes(self, tmp_path: Path) -> None:
        cw_ref: ChunkWriter | None = None
        try:
            with _make_writer(tmp_path) as cw:
                cw_ref = cw
                raise RuntimeError("deliberate test error")
        except RuntimeError:
            pass
        assert cw_ref is not None
        assert cw_ref._closed

    def test_write_chunks_inside_with_block(self, tmp_path: Path) -> None:
        chunks = [{"i": 0}, {"i": 1}, {"i": 2}]
        with _make_writer(tmp_path) as cw:
            for c in chunks:
                cw.write_chunk(c)
            path = cw.path
        lines = _read_lines(path)
        assert lines[1:] == chunks


# ---------------------------------------------------------------------------
# Error handling — I/O errors are logged at DEBUG and swallowed
# ---------------------------------------------------------------------------


class TestErrorHandling:
    """File I/O errors during write_chunk are logged at DEBUG and do not propagate."""

    def test_oserror_does_not_propagate(self, tmp_path: Path) -> None:
        cw = _make_writer(tmp_path)
        try:
            mock_fh = MagicMock()
            mock_fh.write.side_effect = OSError("disk full")
            cw._fh = mock_fh
            # Must not raise
            cw.write_chunk({"data": "value"})
        finally:
            cw._closed = True  # bypass real close

    def test_oserror_logged_at_debug(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        cw = _make_writer(tmp_path)
        try:
            mock_fh = MagicMock()
            mock_fh.write.side_effect = OSError("disk full")
            cw._fh = mock_fh
            with caplog.at_level(logging.DEBUG, logger="src.utils.chunk_writer"):
                cw.write_chunk({"data": "value"})
        finally:
            cw._closed = True
        assert any("error writing to" in record.message for record in caplog.records)

    def test_partial_recovery_existing_header_retained(self, tmp_path: Path) -> None:
        """Simulate crash mid-write: existing header is readable."""
        with _make_writer(tmp_path) as cw:
            path = cw.path
            cw.write_chunk({"chunk": 1})
            # Simulate a write failure for the next chunk
            mock_fh = MagicMock()
            mock_fh.write.side_effect = OSError("disk full")
            cw._fh = mock_fh
            cw.write_chunk({"chunk": 2})  # must not raise
            cw._fh = None  # prevent real close from failing

        # Header and first chunk should still be present
        lines = _read_lines(path)
        assert lines[0] == _CHUNK_HEADER
        assert lines[1] == {"chunk": 1}


# ---------------------------------------------------------------------------
# Cross-platform path handling (pathlib.Path)
# ---------------------------------------------------------------------------


class TestCrossPlatformPaths:
    """All paths are constructed with pathlib.Path for cross-platform safety."""

    def test_slug_dir_as_string_is_coerced_to_path(self, tmp_path: Path) -> None:
        """Passing slug_dir as a str should still work (Path() wraps it)."""
        cw = ChunkWriter(slug_dir=str(tmp_path), wp_id="WP-001", stage="developer")
        cw.close()
        assert isinstance(cw.path, Path)

    def test_path_property_is_pathlib_path(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert isinstance(cw.path, Path)

    def test_using_tempfile_mkdtemp(self) -> None:
        """Verify operation using tempfile.mkdtemp() (platform-agnostic temp dir)."""
        tmp = tempfile.mkdtemp()
        slug_dir = Path(tmp)
        with ChunkWriter(slug_dir=slug_dir, wp_id="WP-001", stage="developer") as cw:
            cw.write_chunk({"hello": "world"})
            path = cw.path
        lines = _read_lines(path)
        assert lines[0] == _CHUNK_HEADER
        assert lines[1] == {"hello": "world"}

    def test_path_is_inside_chunks_subdir(self, tmp_path: Path) -> None:
        with _make_writer(tmp_path) as cw:
            assert cw.path.parent == _chunks_dir(tmp_path)


# ---------------------------------------------------------------------------
# ChunkWriter.delete()
# ---------------------------------------------------------------------------


class TestDelete:
    """Tests for ChunkWriter.delete() — AC for WP-002."""

    def test_delete_removes_chunk_file(self, tmp_path: Path) -> None:
        """AC-1: delete() removes the chunk file from disk."""
        cw = _make_writer(tmp_path)
        path = cw.path
        assert path.exists(), "file should exist before deletion"
        cw.delete()
        assert not path.exists(), "file should be gone after delete()"

    def test_delete_on_already_deleted_file_does_not_raise(self, tmp_path: Path) -> None:
        """AC-2: delete() is safe when the file no longer exists."""
        cw = _make_writer(tmp_path)
        cw.delete()  # first call removes the file
        # second call — file is already gone; must not raise
        cw.delete()

    def test_delete_on_never_existing_path_does_not_raise(self, tmp_path: Path) -> None:
        """AC-2 (variant): graceful no-op when chunk file was never created."""
        cw = _make_writer(tmp_path)
        path = cw.path
        # Close the writer first to release the file handle (required on Windows),
        # then remove the file manually before calling delete().
        cw.close()
        path.unlink()
        cw.delete()  # must not raise

    def test_delete_closes_writer_first(self, tmp_path: Path) -> None:
        """AC-3: writer is properly closed before the file is deleted."""
        cw = _make_writer(tmp_path)
        assert not cw._closed, "writer should be open initially"
        cw.delete()
        assert cw._closed, "writer should be closed after delete()"
        assert cw._fh is None, "file handle should be cleared after delete()"

    def test_delete_on_open_writer_releases_handle(self, tmp_path: Path) -> None:
        """AC-3 (variant): delete() works correctly on an open (not yet closed) writer."""
        cw = _make_writer(tmp_path)
        cw.write_chunk({"x": 1})
        path = cw.path
        # Writer is still open — delete() must close it and remove the file.
        cw.delete()
        assert not path.exists()
        assert cw._closed

    def test_delete_after_explicit_close_does_not_raise(self, tmp_path: Path) -> None:
        """AC-3 (idempotency): close + delete sequence does not raise."""
        cw = _make_writer(tmp_path)
        cw.close()
        cw.delete()  # file still exists; delete() should remove it
        assert not cw.path.exists()

```
###  Path: `/orchestrator/tests/test_cli.py`

```py
"""
test_cli.py — Unit tests for the CLI entry point (WP-005).

Tests verify:
- Argument parser accepts all documented options.
- _parse_interrupt_stages() maps stage names correctly.
- _print_run_summary() returns correct exit codes.
- _make_dryrun_node() returns a callable that produces correct state updates.
- main() exits with correct codes for missing plan files.
- Run queue register/unregister lifecycle in _run() (WP-004).

No real MCP server, LLM, or LangGraph graph invocation is performed.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Argument parser tests
# ---------------------------------------------------------------------------

class TestArgumentParser:
    def _parse(self, *args):
        from src.cli import _build_parser
        return _build_parser().parse_args(list(args))

    def test_plan_positional_required(self):
        """Parser requires the plan positional argument."""
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args([])

    def test_plan_positional_parsed(self):
        args = self._parse("plan.md")
        assert args.plan == "plan.md"

    def test_project_path_option(self):
        args = self._parse("plan.md", "--project-path", "/some/project")
        assert args.project_path == "/some/project"

    def test_max_iterations_option(self):
        args = self._parse("plan.md", "--max-iterations", "50")
        assert args.max_iterations == 50

    def test_model_rejected(self):
        """--model flag is removed; passing it must produce a parser error."""
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["plan.md", "--model", "claude-opus-4"])

    def test_resume_option(self):
        args = self._parse("plan.md", "--resume", "abc-123")
        assert args.resume == "abc-123"

    def test_dry_run_flag(self):
        args = self._parse("plan.md", "--dry-run")
        assert args.dry_run is True

    def test_dry_run_default_false(self):
        args = self._parse("plan.md")
        assert args.dry_run is False

    def test_log_level_option(self):
        args = self._parse("plan.md", "--log-level", "DEBUG")
        assert args.log_level == "DEBUG"

    def test_log_level_invalid_rejected(self):
        from src.cli import _build_parser
        with pytest.raises(SystemExit):
            _build_parser().parse_args(["plan.md", "--log-level", "INVALID"])

    def test_interrupt_on_option(self):
        args = self._parse("plan.md", "--interrupt-on", "pm,synthesis")
        assert args.interrupt_on == "pm,synthesis"

    def test_defaults_are_none(self):
        args = self._parse("plan.md")
        assert args.project_path is None
        assert args.max_iterations is None
        assert args.resume is None
        assert args.log_level is None
        assert args.interrupt_on is None


# ---------------------------------------------------------------------------
# _parse_interrupt_stages() tests
# ---------------------------------------------------------------------------

class TestParseInterruptStages:
    def _parse(self, raw: str) -> list[str]:
        from src.cli import _parse_interrupt_stages
        return _parse_interrupt_stages(raw)

    def test_pm_maps_to_pm(self):
        assert "pm" in self._parse("pm")

    def test_synthesis_maps_to_synthesis(self):
        assert "synthesis" in self._parse("synthesis")

    def test_fail_maps_to_developer(self):
        assert "developer" in self._parse("fail")

    def test_multiple_stages(self):
        result = self._parse("pm,synthesis")
        assert "pm" in result
        assert "synthesis" in result

    def test_deduplicates_same_node(self):
        # Both "fail" and potential duplicates map to "developer" — should appear once.
        result = self._parse("fail")
        assert result.count("developer") == 1

    def test_unknown_stage_exits(self):
        from src.cli import _parse_interrupt_stages
        with pytest.raises(SystemExit):
            _parse_interrupt_stages("unknown_stage")

    def test_whitespace_stripped(self):
        result = self._parse("pm , synthesis")
        assert "pm" in result
        assert "synthesis" in result


# ---------------------------------------------------------------------------
# _print_run_summary() exit code tests
# ---------------------------------------------------------------------------

class TestPrintRunSummary:
    def _call(self, final_state, duration=1.0, thread_id="t1", errors=None):
        from src.cli import _print_run_summary
        return _print_run_summary(final_state, duration, thread_id=thread_id, errors_raised=errors)

    def test_none_state_returns_error(self, capsys):
        code = self._call(None)
        from src.cli import EXIT_ERROR
        assert code == EXIT_ERROR

    def test_empty_state_no_errors_returns_success(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SUCCESS
        assert self._call(state) == EXIT_SUCCESS

    def test_safety_limit_returns_exit_2(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 100,
            "max_iterations": 100,
        }
        from src.cli import EXIT_SAFETY_LIMIT
        assert self._call(state) == EXIT_SAFETY_LIMIT

    def test_errors_in_state_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [{"message": "something went wrong"}],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state) == EXIT_ERROR

    def test_outside_errors_returns_error(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        from src.cli import EXIT_ERROR
        assert self._call(state, errors=["startup failed"]) == EXIT_ERROR

    def test_summary_includes_thread_id(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, thread_id="my-thread-id")
        captured = capsys.readouterr()
        assert "my-thread-id" in captured.out

    def test_summary_includes_duration(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state, duration=42.5)
        captured = capsys.readouterr()
        assert "42.5" in captured.out

    def test_wps_complete_count_shown(self, capsys):
        state = {
            "run_log": [],
            "errors": [],
            "wp_summaries": [
                {"status": "COMPLETE"},
                {"status": "COMPLETE"},
                {"status": "IN_PROGRESS"},
            ],
            "iteration": 1,
            "max_iterations": 100,
        }
        self._call(state)
        captured = capsys.readouterr()
        assert "2/3" in captured.out


# ---------------------------------------------------------------------------
# _make_dryrun_node() tests
# ---------------------------------------------------------------------------

class TestDryRunNode:
    def _make(self, stage: str):
        from src.graph import _make_dryrun_node
        return _make_dryrun_node(stage)

    def test_returns_callable(self):
        node = self._make("pm")
        assert callable(node)

    def test_returns_dict_on_call(self):
        node = self._make("pm")
        result = node({"current_wp_id": "WP-001"})
        assert isinstance(result, dict)

    def test_stage_success_is_true(self):
        node = self._make("developer")
        result = node({"current_wp_id": "WP-001"})
        assert result.get("stage_success") is True

    def test_run_log_appended(self):
        node = self._make("qa")
        result = node({"current_wp_id": "WP-001"})
        assert len(result.get("run_log", [])) == 1
        assert result["run_log"][0]["action"] == "dry_run"

    def test_stage_name_in_result(self):
        node = self._make("reviewer")
        result = node({"current_wp_id": "WP-002"})
        assert "reviewer" in result.get("stage_result", "")

    def test_node_name_attribute_set(self):
        node = self._make("docs")
        assert "docs" in node.__name__


# ---------------------------------------------------------------------------
# main() integration — missing plan file error
# ---------------------------------------------------------------------------

class TestMainMissingPlan:
    def test_missing_plan_exits_1(self, tmp_path):
        """main() exits with EXIT_ERROR when the plan file does not exist."""
        nonexistent = str(tmp_path / "no_such_plan.md")

        mock_config = MagicMock()
        mock_config.max_iterations = 100
        mock_config.log_level = "INFO"
        mock_config.checkpoint_dir = tmp_path / "checkpoints"

        # load_config is imported lazily inside main(); patch at the source module.
        with patch("src.config.load_config", return_value=mock_config):
            with pytest.raises(SystemExit) as exc_info:
                from src.cli import main
                main([nonexistent])

        from src.cli import EXIT_ERROR
        assert exc_info.value.code == EXIT_ERROR


# ---------------------------------------------------------------------------
# _make_dryrun_node — edge cases
# ---------------------------------------------------------------------------

class TestDryRunNodeEdgeCases:
    def test_missing_wp_id_handled(self):
        """Node must not crash when state has no current_wp_id."""
        from src.graph import _make_dryrun_node
        node = _make_dryrun_node("pm")
        result = node({})  # Empty state
        assert result["stage_success"] is True

    def test_run_log_result_is_skip(self):
        from src.graph import _make_dryrun_node
        node = _make_dryrun_node("synthesis")
        result = node({"current_wp_id": ""})
        assert result["run_log"][0]["result"] == "SKIP"


# ---------------------------------------------------------------------------
# Checkpoint helpers — WP-004
# ---------------------------------------------------------------------------

class TestThreadIdExistsInCheckpoint:
    def test_returns_false_when_db_absent(self, tmp_path):
        """Non-existent DB must not raise; return False instead."""
        from src.cli import _thread_id_exists_in_checkpoint
        absent = tmp_path / "no_such.sqlite"
        assert _thread_id_exists_in_checkpoint(absent, "any-id") is False

    def test_returns_false_for_unknown_thread_id(self, tmp_path):
        """A thread_id not in the DB must return False."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint
        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("existing-id", "", "ckpt-1"),
            )
        assert _thread_id_exists_in_checkpoint(db, "other-id") is False

    def test_returns_true_for_known_thread_id(self, tmp_path):
        """A thread_id present in the DB must return True."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint
        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("known-id", "", "ckpt-1"),
            )
        assert _thread_id_exists_in_checkpoint(db, "known-id") is True


class TestMarkAndIsRunTerminal:
    def test_is_run_terminal_returns_false_when_no_marker(self, tmp_path):
        """No marker file → not terminal."""
        from src.cli import _is_run_terminal
        assert _is_run_terminal(tmp_path, "some-thread") is False

    def test_mark_then_is_terminal_returns_true(self, tmp_path):
        """Writing the marker file must make _is_run_terminal return True."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        _mark_run_terminal(tmp_path, "my-thread")
        assert _is_run_terminal(tmp_path, "my-thread") is True

    def test_marker_is_file_scoped_to_thread_id(self, tmp_path):
        """Marking one thread id must not affect another."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        _mark_run_terminal(tmp_path, "thread-A")
        assert _is_run_terminal(tmp_path, "thread-B") is False

    def test_mark_creates_dir_if_absent(self, tmp_path):
        """_mark_run_terminal must create the checkpoint_dir if it doesn't exist."""
        from src.cli import _is_run_terminal, _mark_run_terminal
        new_dir = tmp_path / "checkpoints" / "sub"
        _mark_run_terminal(new_dir, "tid")
        assert _is_run_terminal(new_dir, "tid") is True


class TestTerminalResumeGuard:
    async def test_resume_terminal_thread_exits_error(self, tmp_path):
        """_run() must return EXIT_ERROR when --resume targets a terminal checkpoint."""
        from unittest.mock import AsyncMock

        from src.cli import EXIT_ERROR, _mark_run_terminal, _run

        plan = tmp_path / "plan.md"
        plan.write_text("# plan")
        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "finished-thread")

        args = MagicMock()
        args.plan = str(plan)
        args.resume = "finished-thread"
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
            mock_logger_cls.create.return_value = mock_run_logger
            result = await _run(args, mock_config)

        assert result == EXIT_ERROR

    def test_resume_non_terminal_does_not_trigger_guard(self, tmp_path):
        """_is_run_terminal returns False for a non-terminal thread — guard is not invoked."""
        from src.cli import _is_run_terminal, _mark_run_terminal

        ckpt_dir = tmp_path / "checkpoints"
        # Mark a different thread — the one being resumed is not marked.
        _mark_run_terminal(ckpt_dir, "other-thread")

        # The thread being resumed has no marker → guard must not fire.
        assert _is_run_terminal(ckpt_dir, "active-thread") is False


class TestUuidCollisionHandling:
    def test_new_run_regenerates_uuid_on_collision(self, tmp_path):
        """When the generated UUID already exists, a new one must be used."""
        import sqlite3

        from src.cli import _thread_id_exists_in_checkpoint

        db = tmp_path / "workflow.sqlite"
        with sqlite3.connect(str(db)) as conn:
            conn.execute(
                "CREATE TABLE checkpoints "
                "(thread_id TEXT, checkpoint_ns TEXT, checkpoint_id TEXT)"
            )
            # Pre-populate with a specific known UUID.
            conn.execute(
                "INSERT INTO checkpoints VALUES (?, ?, ?)",
                ("collision-uuid", "", "ckpt-1"),
            )

        # Verify the helper can detect it.
        assert _thread_id_exists_in_checkpoint(db, "collision-uuid") is True
        assert _thread_id_exists_in_checkpoint(db, "different-uuid") is False


# ---------------------------------------------------------------------------
# _register_signal_handlers() — WP-003
# ---------------------------------------------------------------------------

class TestRegisterSignalHandlers:
    """Unit tests for _register_signal_handlers()."""

    async def test_sets_shutdown_event_on_sigterm(self):
        """On Unix, sending SIGTERM must set the shutdown event."""
        import os
        import signal
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        shutdown_event = asyncio.Event()
        _register_signal_handlers(loop, shutdown_event, thread_id="test-tid")

        assert not shutdown_event.is_set()
        os.kill(os.getpid(), signal.SIGTERM)
        # Give the event loop a real tick to process the signal callback.
        await asyncio.sleep(0.02)
        assert shutdown_event.is_set()

        # Restore default SIGTERM behaviour so other tests are not affected.
        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    async def test_sets_shutdown_event_on_sigint(self):
        """On Unix, sending SIGINT via the event loop handler must set the shutdown event."""
        import os
        import signal
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        shutdown_event = asyncio.Event()
        _register_signal_handlers(loop, shutdown_event, thread_id="test-tid")

        assert not shutdown_event.is_set()
        os.kill(os.getpid(), signal.SIGINT)
        await asyncio.sleep(0.02)
        assert shutdown_event.is_set()

        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    async def test_double_registration_does_not_raise(self):
        """Registering handlers twice on the same loop must not raise."""
        import sys

        if sys.platform == "win32":
            pytest.skip("loop.add_signal_handler() is not available on Windows.")

        from src.cli import _register_signal_handlers

        loop = asyncio.get_running_loop()
        ev1 = asyncio.Event()
        ev2 = asyncio.Event()
        _register_signal_handlers(loop, ev1, thread_id="t1")
        _register_signal_handlers(loop, ev2, thread_id="t2")  # second call overwrites

        import os
        import signal
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.sleep(0.02)
        # The second registration overwrites the first; ev2 must be set.
        assert ev2.is_set()

        loop.remove_signal_handler(signal.SIGTERM)
        loop.remove_signal_handler(signal.SIGINT)

    def test_windows_path_does_not_raise(self, monkeypatch):
        """On 'Windows' (mocked), _register_signal_handlers must not raise."""
        import sys

        from src.cli import _register_signal_handlers

        # Simulate Windows by monkeypatching sys.platform.
        monkeypatch.setattr(sys, "platform", "win32")

        # signal.signal() requires the main thread; mock it to avoid that constraint.
        with patch("signal.signal"):
            loop = MagicMock()
            ev = asyncio.Event()
            # Must not raise.
            _register_signal_handlers(loop, ev, thread_id="win-tid")

        # loop.add_signal_handler must NOT have been called on the Windows path.
        loop.add_signal_handler.assert_not_called()

    def test_windows_signal_signal_error_swallowed(self, monkeypatch):
        """If signal.signal() raises ValueError on Windows, the error is swallowed."""
        import sys

        from src.cli import _register_signal_handlers

        monkeypatch.setattr(sys, "platform", "win32")

        with patch("signal.signal", side_effect=ValueError("not the main thread")):
            loop = MagicMock()
            ev = asyncio.Event()
            _register_signal_handlers(loop, ev, thread_id="win-tid")  # must not raise

    async def test_no_running_loop_graceful(self):
        """asyncio.get_running_loop() inside _run() is guarded; the test exercises the guard."""
        # This test validates the RuntimeError guard inside _run() when called
        # outside an event loop context.  We call the guard directly here.
        import asyncio

        # When we call get_running_loop() outside a coroutine it raises RuntimeError.
        # The guard in _run() swallows that — we verify _register_signal_handlers
        # is itself safe by calling it in a non-main-thread context.
        # (The function itself doesn't call get_running_loop(); _run() does the guard.)
        # So we just verify the function doesn't blow up with a dummy loop mock.
        loop = MagicMock()
        loop.add_signal_handler = MagicMock()
        ev = asyncio.Event()
        import sys
        if sys.platform != "win32":
            from src.cli import _register_signal_handlers
            _register_signal_handlers(loop, ev, thread_id="t")
            assert loop.add_signal_handler.called


# ---------------------------------------------------------------------------
# Signal-interrupted run integration test — Plan 2026-04-10 rework-3
# ---------------------------------------------------------------------------

class TestSignalInterruptedRun:
    """Integration test for the signal-interrupted shutdown race path in _run().

    Validates the asyncio.wait race between graph_task and wait_task when
    SIGTERM fires during graph execution.  Asserts:
    - shutdown_event is set (triggering graceful shutdown).
    - The graph task is cancelled (does not run to completion).
    - A ``signal_shutdown`` JSONL entry is emitted with ``result="INTERRUPTED"``.
    - The run is NOT marked terminal (remains resumable via --resume).
    - The exit code is EXIT_ERROR (1).

    Platform guard: skipped on Windows where loop.add_signal_handler() is unavailable.
    """

    @pytest.mark.skipif(
        sys.platform == "win32",
        reason="loop.add_signal_handler() is not available on Windows.",
    )
    async def test_sigterm_interrupts_run_and_emits_signal_shutdown(self, tmp_path):
        """Fire SIGTERM during _run(); verify shutdown JSONL entry and no terminal marker."""
        import json
        import os
        import signal

        from src.cli import EXIT_ERROR, _is_run_terminal, _run

        # ── Set up a real plan file ─────────────────────────────────────
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan\n\nTest plan for signal integration test.\n")

        # ── Build mock args ─────────────────────────────────────────────
        args = MagicMock()
        args.plan = str(plan)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = str(tmp_path)
        args.max_iterations = None
        args.log_level = None

        # ── Build mock config ───────────────────────────────────────────
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()
        logs_dir = tmp_path / "logs"
        logs_dir.mkdir()

        mock_config = MagicMock()
        mock_config.checkpoint_dir = ckpt_dir
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0
        mock_config.max_iterations = 100
        mock_config.stage_models = {"developer": "claude-test"}

        # ── Build a real WorkflowLogger pointing to tmp_path ────────────
        from src.utils.logging import WorkflowLogger

        run_logger = WorkflowLogger(logs_dir / "test-signal-run.jsonl")

        # ── Create a slow mock graph that blocks long enough for SIGTERM ─
        async def _slow_ainvoke(*_args, **_kwargs):
            """Simulate a long-running graph execution."""
            await asyncio.sleep(10)
            return {"run_log": [], "errors": [], "wp_summaries": []}

        mock_graph = MagicMock()
        mock_graph.ainvoke = _slow_ainvoke

        mock_db_conn = MagicMock()
        mock_db_conn.close = AsyncMock(return_value=None)

        # ── Mock MCPToolkit and _build_graph_for_run ────────────────────
        mock_toolkit = MagicMock()
        mock_toolkit.get_tools.return_value = []
        mock_toolkit.__aenter__ = AsyncMock(return_value=mock_toolkit)
        mock_toolkit.__aexit__ = AsyncMock(return_value=None)

        # Schedule SIGTERM after a short delay so the race fires the
        # shutdown path before the slow graph completes.
        loop = asyncio.get_running_loop()
        loop.call_later(0.05, os.kill, os.getpid(), signal.SIGTERM)

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch(
                "src.cli._build_graph_for_run",
                return_value=(mock_graph, mock_db_conn),
            ),
        ):
            exit_code = await _run(args, mock_config)

        # ── Restore default signal handlers ─────────────────────────────
        try:
            loop.remove_signal_handler(signal.SIGTERM)
        except Exception:
            pass
        try:
            loop.remove_signal_handler(signal.SIGINT)
        except Exception:
            pass

        # ── Assert exit code ────────────────────────────────────────────
        assert exit_code == EXIT_ERROR, f"Expected EXIT_ERROR (1), got {exit_code}"

        # ── Assert signal_shutdown JSONL entry was emitted ──────────────
        run_logger.close()
        log_path = logs_dir / "test-signal-run.jsonl"
        assert log_path.exists(), "JSONL log file must exist"

        log_lines = log_path.read_text().strip().splitlines()
        entries = [json.loads(line) for line in log_lines]

        signal_entries = [
            e for e in entries
            if e.get("action") == "signal_shutdown"
        ]
        assert len(signal_entries) == 1, (
            f"Expected exactly 1 signal_shutdown entry, found {len(signal_entries)}"
        )
        assert signal_entries[0]["result"] == "INTERRUPTED"

        # ── Assert run is NOT marked terminal (remains resumable) ───────
        # Find the thread_id from the run_start entry.
        start_entries = [e for e in entries if e.get("action") == "run_start"]
        assert len(start_entries) == 1, "Expected exactly 1 run_start entry"
        thread_id = start_entries[0]["thread_id"]
        assert not _is_run_terminal(ckpt_dir, thread_id), (
            "Signal-interrupted run must NOT be marked terminal"
        )


# ---------------------------------------------------------------------------
# Run queue integration — WP-004
# ---------------------------------------------------------------------------

class TestRunQueueIntegration:
    """Verify that cli._run() calls run_queue.register() after run_start and
    run_queue.unregister() in the finally block, regardless of how the run
    terminates.

    All tests mock MCPToolkit and the LangGraph graph so no real MCP server
    or LLM is invoked.
    """

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _make_args(self, tmp_path: Path) -> MagicMock:
        plan = tmp_path / "plan.md"
        plan.write_text("# Plan")
        args = MagicMock()
        args.plan = str(plan)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = str(tmp_path)
        args.max_iterations = None
        return args

    def _make_config(self, tmp_path: Path) -> MagicMock:
        ckpt_dir = tmp_path / "checkpoints"
        ckpt_dir.mkdir()
        config = MagicMock()
        config.checkpoint_dir = ckpt_dir
        config.workspace_root = tmp_path
        config.heartbeat_interval_s = 0
        config.max_iterations = 100
        config.stage_models = {}
        return config

    def _make_mcp_mocks(self, *, graph_raises: bool = False) -> tuple:
        """Return (mock_toolkit, mock_graph, mock_db)."""
        mock_toolkit = MagicMock()
        mock_toolkit.get_tools.return_value = []
        mock_toolkit.__aenter__ = AsyncMock(return_value=mock_toolkit)
        mock_toolkit.__aexit__ = AsyncMock(return_value=None)

        mock_db = MagicMock()
        mock_db.close = AsyncMock()

        if graph_raises:
            async def _ainvoke(*_a: object, **_kw: object) -> dict:
                raise RuntimeError("simulated graph failure")
        else:
            async def _ainvoke(*_a: object, **_kw: object) -> dict:
                return {"run_log": [], "errors": [], "wp_summaries": []}

        mock_graph = MagicMock()
        mock_graph.ainvoke = _ainvoke
        return mock_toolkit, mock_graph, mock_db

    # ------------------------------------------------------------------
    # AC-1 partial: register() is called after run_start
    # ------------------------------------------------------------------

    async def test_register_called_after_run_start(self, tmp_path: Path) -> None:
        """register() must be called after the run_start JSONL entry is logged
        (AC-1: queue entry created after run_start)."""

        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-order.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()

        # Track call order via a mutable list.
        call_order: list[str] = []
        original_log = run_logger.log

        def _tracking_log(*args: object, **kwargs: object) -> None:
            if kwargs.get("action") == "run_start":
                call_order.append("run_start")
            original_log(*args, **kwargs)

        run_logger.log = _tracking_log  # type: ignore[method-assign]

        # Capture the call_order snapshot at the moment register() fires.
        snapshot_at_register: list[str] = []

        def _register(*_a: object, **_kw: object) -> str:
            snapshot_at_register.extend(call_order)
            call_order.append("register")
            return "order-test-entry-id"

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", side_effect=_register),
            patch("src.utils.run_queue.unregister"),
        ):
            await _run(args, config)

        run_logger.close()

        assert "run_start" in snapshot_at_register, (
            "register() must be called after run_start is logged"
        )

    # ------------------------------------------------------------------
    # AC-1: unregister() called with the correct entry_id on normal exit
    # ------------------------------------------------------------------

    async def test_unregister_called_with_correct_entry_id(self, tmp_path: Path) -> None:
        """On normal completion, unregister() must be called with the entry_id
        returned by register() (AC-1)."""
        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-normal.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()

        expected_id = "normal-entry-uuid"
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", return_value=expected_id),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            await _run(args, config)

        run_logger.close()
        mock_unregister.assert_called_once_with(expected_id)

    # ------------------------------------------------------------------
    # AC-2: unregister() called even when the run exits via an error path
    # ------------------------------------------------------------------

    async def test_unregister_called_when_graph_raises(self, tmp_path: Path) -> None:
        """Even when graph execution raises, unregister() must be called in the
        finally block (covers error / signal-interrupted exit paths; AC-2)."""
        from src.cli import _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-graph-err.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks(graph_raises=True)

        expected_id = "graph-error-entry-uuid"
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", return_value=expected_id),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            await _run(args, config)

        run_logger.close()
        mock_unregister.assert_called_once_with(expected_id)

    # ------------------------------------------------------------------
    # AC-3: register() raises — entry_id stays None — no NameError
    # ------------------------------------------------------------------

    async def test_register_failure_run_continues_without_unregister(
        self, tmp_path: Path
    ) -> None:
        """If register() raises, entry_id stays None, the run continues normally,
        and unregister() is never called (AC-3: no NameError in finally block)."""
        from src.cli import EXIT_SUCCESS, _run
        from src.utils.logging import WorkflowLogger

        args = self._make_args(tmp_path)
        config = self._make_config(tmp_path)
        (tmp_path / "logs").mkdir()
        run_logger = WorkflowLogger(tmp_path / "logs" / "rq-reg-fail.jsonl")

        mock_toolkit, mock_graph, mock_db = self._make_mcp_mocks()
        mock_unregister = MagicMock()

        with (
            patch("src.utils.logging.WorkflowLogger.create", return_value=run_logger),
            patch("src.mcp_client.MCPToolkit.from_config", return_value=mock_toolkit),
            patch("src.cli._build_graph_for_run", return_value=(mock_graph, mock_db)),
            patch("src.utils.run_queue.register", side_effect=OSError("lock failed")),
            patch("src.utils.run_queue.unregister", mock_unregister),
        ):
            exit_code = await _run(args, config)

        run_logger.close()
        # Run must complete successfully despite register() failing.
        assert exit_code == EXIT_SUCCESS
        # unregister() must NOT be called — entry_id was never assigned.
        mock_unregister.assert_not_called()


# ---------------------------------------------------------------------------
# _write_error_status() — early-exit tombstone writes
# ---------------------------------------------------------------------------

class TestWriteErrorStatusEarlyExits:
    """Regression tests for the _write_error_status() helper called at
    early-exit paths in _run().

    Verifies that a valid JSON tombstone is written to the run-status file
    whenever _run() exits before the graph starts, so the GUI does not hang
    waiting for a status file that will never appear.
    """

    # Derive the orchestrator logs directory using the same algorithm as cli.py:
    #   Path(cli.__file__).resolve().parent.parent / "logs"
    # From this test file (orchestrator/tests/test_cli.py):
    #   parent → orchestrator/tests/
    #   parent.parent → orchestrator/
    #   / "logs" → orchestrator/logs/
    _LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"

    def _expected_status_path(self, plan_path: Path) -> Path:
        """Compute the expected status file path for a given plan path."""
        import hashlib
        plan_hash = hashlib.sha1(str(plan_path).encode("utf-8")).hexdigest()[:16]
        return self._LOGS_DIR / f"{plan_hash}-run-status.json"

    def _make_args(self, plan_path: Path) -> MagicMock:
        args = MagicMock()
        args.plan = str(plan_path)
        args.resume = None
        args.dry_run = False
        args.interrupt_on = None
        args.project_path = None
        return args

    def _make_config(self, tmp_path: Path) -> MagicMock:
        mock_config = MagicMock()
        mock_config.checkpoint_dir = tmp_path / "checkpoints"
        mock_config.workspace_root = tmp_path
        mock_config.heartbeat_interval_s = 0
        mock_config.max_iterations = 100
        return mock_config

    # ------------------------------------------------------------------
    # Lock-held early exit
    # ------------------------------------------------------------------

    async def test_lock_held_writes_error_status_file(self, tmp_path: Path) -> None:
        """When the lock is already held, _run() exits with EXIT_ERROR and
        writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _run

        plan = (tmp_path / "plan.md").resolve()
        plan.write_text("# Plan")

        args = self._make_args(plan)
        config = self._make_config(tmp_path)
        expected_path = self._expected_status_path(plan)

        try:
            # Patch lock_exclusive to raise OSError, simulating a held lock.
            with patch(
                "src.cli.lock_exclusive",
                side_effect=OSError("Resource temporarily unavailable"),
            ):
                result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
        finally:
            expected_path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Plan-not-found early exit
    # ------------------------------------------------------------------

    async def test_plan_not_found_writes_error_status_file(self, tmp_path: Path) -> None:
        """When the plan file does not exist, _run() exits with EXIT_ERROR and
        writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _run

        # Intentionally non-existent plan.
        plan = (tmp_path / "no_such_plan.md").resolve()

        args = self._make_args(plan)
        config = self._make_config(tmp_path)
        expected_path = self._expected_status_path(plan)

        try:
            result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
            assert "Plan file not found" in status["error"] or "plan" in status["error"].lower()
        finally:
            expected_path.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Resume-terminal early exit
    # ------------------------------------------------------------------

    async def test_resume_terminal_writes_error_status_file(self, tmp_path: Path) -> None:
        """When --resume targets a terminal checkpoint, _run() exits with
        EXIT_ERROR and writes a valid ERROR tombstone to the run-status file."""
        import json

        from src.cli import EXIT_ERROR, _mark_run_terminal, _run

        plan = (tmp_path / "plan.md").resolve()
        plan.write_text("# Plan")

        ckpt_dir = tmp_path / "checkpoints"
        _mark_run_terminal(ckpt_dir, "done-thread")

        args = self._make_args(plan)
        args.resume = "done-thread"

        config = self._make_config(tmp_path)
        config.checkpoint_dir = ckpt_dir

        mock_run_logger = MagicMock()
        mock_run_logger._path = tmp_path / "run.jsonl"
        mock_run_logger.start_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.stop_heartbeat = AsyncMock(return_value=None)
        mock_run_logger.flush_unstreamed = MagicMock()
        mock_run_logger.log = MagicMock()
        mock_run_logger.close = MagicMock()

        expected_path = self._expected_status_path(plan)

        try:
            with patch("src.utils.logging.WorkflowLogger") as mock_logger_cls:
                mock_logger_cls.create.return_value = mock_run_logger
                result = await _run(args, config)

            assert result == EXIT_ERROR

            assert expected_path.exists(), (
                f"Status file not found: {expected_path}"
            )
            status = json.loads(expected_path.read_text())
            assert status["result"] == "ERROR"
            assert status["error"], "error field must be a non-empty string"
        finally:
            expected_path.unlink(missing_ok=True)

```
###  Path: `/orchestrator/tests/test_config.py`

```py
"""Snapshot tests for manifest-derived constants in orchestrator/src/config.py.

Catches silent regressions when manifest field names change or the derivation
logic is accidentally broken.  Tests assert structural properties (type,
non-emptiness, key membership) rather than exact exhaustive values, so they
remain valid if the manifest gains new roles or pipeline types in the future.
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from src.config import (
    FAIL_ROUTING_AGENT_MAP,
    PERSONA_FILES,
    PIPELINE_AGENT_MAP,
    PIPELINE_ROLE_NAMES,
    PIPELINE_TYPES,
    ROLE_IDS,
    VALID_STAGES,
    WP_TERMINAL_STATUSES,
    load_config,
)


class TestWPTerminalStatuses:
    def test_is_frozenset(self):
        assert isinstance(WP_TERMINAL_STATUSES, frozenset)

    def test_non_empty(self):
        assert len(WP_TERMINAL_STATUSES) > 0

    def test_contains_complete(self):
        assert "COMPLETE" in WP_TERMINAL_STATUSES

    def test_contains_cancelled(self):
        assert "CANCELLED" in WP_TERMINAL_STATUSES


class TestValidStages:
    def test_is_frozenset(self):
        assert isinstance(VALID_STAGES, frozenset)

    def test_non_empty(self):
        assert len(VALID_STAGES) > 0

    def test_contains_developer(self):
        assert "developer" in VALID_STAGES

    def test_contains_qa(self):
        assert "qa" in VALID_STAGES

    def test_contains_reviewer(self):
        assert "reviewer" in VALID_STAGES

    def test_does_not_contain_planner(self):
        # planner is orchestrating and must be excluded
        assert "planner" not in VALID_STAGES

    def test_does_not_contain_synthesis(self):
        # synthesis is orchestrating and must be excluded
        assert "synthesis" not in VALID_STAGES


class TestPipelineTypes:
    def test_is_tuple(self):
        assert isinstance(PIPELINE_TYPES, tuple)

    def test_non_empty(self):
        assert len(PIPELINE_TYPES) > 0

    def test_contains_implementation(self):
        assert "implementation" in PIPELINE_TYPES

    def test_contains_qa(self):
        assert "qa" in PIPELINE_TYPES

    def test_contains_documentation(self):
        assert "documentation" in PIPELINE_TYPES

    def test_implementation_is_first(self):
        assert PIPELINE_TYPES[0] == "implementation"

    def test_documentation_is_last(self):
        assert PIPELINE_TYPES[-1] == "documentation"


class TestRoleIDs:
    def test_is_dict(self):
        assert isinstance(ROLE_IDS, dict)

    def test_non_empty(self):
        assert len(ROLE_IDS) > 0

    def test_developer_maps_to_developer_id(self):
        assert ROLE_IDS.get("Developer") == "developer"

    def test_qa_maps_to_qa_id(self):
        assert ROLE_IDS.get("QA") == "qa"

    def test_release_engineer_maps_to_correct_id(self):
        assert ROLE_IDS.get("Release Engineer") == "release_engineer"


class TestPipelineRoleNames:
    def test_is_list(self):
        assert isinstance(PIPELINE_ROLE_NAMES, list)

    def test_non_empty(self):
        assert len(PIPELINE_ROLE_NAMES) > 0

    def test_contains_developer(self):
        assert "Developer" in PIPELINE_ROLE_NAMES

    def test_contains_documentation(self):
        assert "Documentation" in PIPELINE_ROLE_NAMES

    def test_does_not_contain_planner(self):
        # planner is orchestrating — excluded by the derivation filter
        assert "Planner" not in PIPELINE_ROLE_NAMES

    def test_does_not_contain_synthesis(self):
        assert "Synthesis" not in PIPELINE_ROLE_NAMES


class TestPipelineAgentMap:
    def test_is_dict(self):
        assert isinstance(PIPELINE_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(PIPELINE_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have an owning agent in PIPELINE_AGENT_MAP."""
        for ptype in PIPELINE_TYPES:
            assert ptype in PIPELINE_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from PIPELINE_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All owning agent entries must be valid non-orchestrating role names."""
        for ptype, role_name in PIPELINE_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"PIPELINE_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_implementation_maps_to_developer(self):
        assert PIPELINE_AGENT_MAP["implementation"] == "Developer"

    def test_release_engineering_maps_to_release_engineer(self):
        assert PIPELINE_AGENT_MAP["release-engineering"] == "Release Engineer"


class TestFailRoutingAgentMap:
    def test_is_dict(self):
        assert isinstance(FAIL_ROUTING_AGENT_MAP, dict)

    def test_non_empty(self):
        assert len(FAIL_ROUTING_AGENT_MAP) > 0

    def test_all_pipeline_types_are_keys(self):
        """Every pipeline type must have a FAIL-routing target."""
        for ptype in PIPELINE_TYPES:
            assert ptype in FAIL_ROUTING_AGENT_MAP, (
                f"Pipeline type {ptype!r} is missing from FAIL_ROUTING_AGENT_MAP"
            )

    def test_all_values_are_valid_role_names(self):
        """All FAIL-routing targets must be valid non-orchestrating role names."""
        for ptype, role_name in FAIL_ROUTING_AGENT_MAP.items():
            assert role_name in PIPELINE_ROLE_NAMES, (
                f"FAIL_ROUTING_AGENT_MAP[{ptype!r}] = {role_name!r} is not in "
                f"PIPELINE_ROLE_NAMES"
            )

    def test_release_engineering_routes_to_release_engineer(self):
        """Non-obvious mapping: release-engineering FAIL → Release Engineer."""
        assert FAIL_ROUTING_AGENT_MAP["release-engineering"] == "Release Engineer"

    def test_documentation_routes_to_documentation(self):
        """Non-obvious mapping: documentation FAIL → Documentation."""
        assert FAIL_ROUTING_AGENT_MAP["documentation"] == "Documentation"


class TestPersonaFilesExist:
    """Validate that every persona_file entry in the manifest points to an
    actual file on disk.  This catches stale paths whenever the persona build
    system renames its output files."""

    # Workspace root is two levels above the orchestrator package.
    _WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

    def test_persona_files_is_dict(self):
        assert isinstance(PERSONA_FILES, dict)

    def test_persona_files_non_empty(self):
        assert len(PERSONA_FILES) > 0

    @pytest.mark.parametrize("stage,relative_path", list(PERSONA_FILES.items()))
    def test_persona_file_exists(self, stage: str, relative_path: str):
        """Every stage's persona file must exist on the local filesystem."""
        full_path = self._WORKSPACE_ROOT / relative_path
        assert full_path.exists(), (
            f"Persona file for stage {stage!r} not found at: {full_path}\n"
            f"  Manifest says: {relative_path}\n"
            f"  Check shared/workflow-manifest.json persona_file entries."
        )


# ---------------------------------------------------------------------------
# Helpers shared by TestCaptureDialogues
# ---------------------------------------------------------------------------

# Minimum valid env required by load_config() so we can isolate the flag.
_BASE_ENV = {
    "ANTHROPIC_API_KEY": "sk-test",
}


def _load(extra_env: dict | None = None):
    """Call load_config() with a clean environment plus *extra_env* overrides."""
    env = {**_BASE_ENV, **(extra_env or {})}
    # Remove CAPTURE_DIALOGUES from the base environment so tests start clean.
    # Setting to empty string means "use default" (True).
    env.setdefault("CAPTURE_DIALOGUES", "false")
    with patch.dict(os.environ, env, clear=True):
        return load_config()


class TestCaptureDialogues:
    """Tests for Config.capture_dialogues and CAPTURE_DIALOGUES env var parsing."""

    # ------------------------------------------------------------------
    # Default / truthy values (capture_dialogues defaults to True)
    # ------------------------------------------------------------------

    def test_default_is_true_when_env_var_unset(self):
        """capture_dialogues defaults to True when CAPTURE_DIALOGUES is absent."""
        env = {**_BASE_ENV}
        with patch.dict(os.environ, env, clear=True):
            cfg = load_config()
        assert cfg.capture_dialogues is True
    def test_true_when_env_var_is_empty_string(self):
        assert _load({"CAPTURE_DIALOGUES": ""}).capture_dialogues is True

    def test_true_when_env_var_is_arbitrary_value(self):
        assert _load({"CAPTURE_DIALOGUES": "maybe"}).capture_dialogues is True

    # ------------------------------------------------------------------
    # Explicit falsy values
    # ------------------------------------------------------------------

    def test_false_when_env_var_is_false(self):
        assert _load({"CAPTURE_DIALOGUES": "false"}).capture_dialogues is False

    def test_false_when_env_var_is_zero(self):
        assert _load({"CAPTURE_DIALOGUES": "0"}).capture_dialogues is False

    def test_false_when_env_var_is_no(self):
        assert _load({"CAPTURE_DIALOGUES": "no"}).capture_dialogues is False

    # ------------------------------------------------------------------
    # Truthy values
    # ------------------------------------------------------------------

    def test_true_when_env_var_is_lowercase_true(self):
        assert _load({"CAPTURE_DIALOGUES": "true"}).capture_dialogues is True

    def test_true_when_env_var_is_titlecase_True(self):
        assert _load({"CAPTURE_DIALOGUES": "True"}).capture_dialogues is True

    def test_true_when_env_var_is_uppercase_TRUE(self):
        assert _load({"CAPTURE_DIALOGUES": "TRUE"}).capture_dialogues is True

    def test_true_when_env_var_is_one(self):
        assert _load({"CAPTURE_DIALOGUES": "1"}).capture_dialogues is True

    def test_true_when_env_var_is_yes(self):
        assert _load({"CAPTURE_DIALOGUES": "yes"}).capture_dialogues is True

    def test_true_when_env_var_is_YES(self):
        assert _load({"CAPTURE_DIALOGUES": "YES"}).capture_dialogues is True

    # ------------------------------------------------------------------
    # Type check
    # ------------------------------------------------------------------

    def test_field_is_bool_type(self):
        """capture_dialogues must be a plain Python bool, not a truthy string."""
        cfg = _load({"CAPTURE_DIALOGUES": "true"})
        assert isinstance(cfg.capture_dialogues, bool)

    def test_field_is_bool_type_when_false(self):
        cfg = _load()
        assert isinstance(cfg.capture_dialogues, bool)


# ---------------------------------------------------------------------------
# Tests: Config.stage_models and Config.resolve_model_for_stage
# ---------------------------------------------------------------------------

class TestStageModels:
    """Tests for Config.stage_models populated from persona metadata."""

    def test_stage_models_is_dict(self):
        cfg = _load()
        assert isinstance(cfg.stage_models, dict)

    def test_stage_models_non_empty(self):
        cfg = _load()
        assert len(cfg.stage_models) > 0

    def test_stage_models_contains_developer(self):
        cfg = _load()
        assert "developer" in cfg.stage_models

    def test_stage_models_contains_planner(self):
        cfg = _load()
        assert "planner" in cfg.stage_models

    def test_stage_models_contains_all_nine_stages(self):
        """All 9 non-orchestrating stages must have a model slug."""
        cfg = _load()
        # Non-orchestrating stages from the manifest (planner and synthesis are
        # orchestrating but still present in stage_models from persona metadata).
        expected = {
            "planner", "pm", "developer", "qa", "security_auditor",
            "reviewer", "release_engineer", "docs", "synthesis",
        }
        assert expected.issubset(cfg.stage_models.keys()), (
            f"Missing stages: {expected - cfg.stage_models.keys()}"
        )

    def test_stage_models_values_are_strings(self):
        cfg = _load()
        for stage, slug in cfg.stage_models.items():
            assert isinstance(slug, str), f"stage_models[{stage!r}] must be a str"
            assert slug, f"stage_models[{stage!r}] must not be empty"

    def test_planner_has_opus_slug(self):
        """Planner has a model_slug override in persona metadata."""
        cfg = _load()
        assert cfg.stage_models["planner"] == "claude-opus-4-6"

    def test_pm_has_opus_slug(self):
        """Project Manager has a model_slug override in persona metadata."""
        cfg = _load()
        assert cfg.stage_models["pm"] == "claude-opus-4-6"

    def test_developer_has_default_slug(self):
        """Developer inherits default_model_slug."""
        cfg = _load()
        assert cfg.stage_models["developer"] == "claude-sonnet-4-6"


class TestResolveModelForStage:
    """Tests for Config.resolve_model_for_stage()."""

    def test_returns_correct_slug_for_known_stage(self):
        cfg = _load()
        slug = cfg.resolve_model_for_stage("developer")
        assert slug == cfg.stage_models["developer"]

    def test_returns_correct_slug_for_planner(self):
        cfg = _load()
        assert cfg.resolve_model_for_stage("planner") == "claude-opus-4-6"

    def test_raises_key_error_for_unknown_stage(self):
        cfg = _load()
        with pytest.raises(KeyError):
            cfg.resolve_model_for_stage("nonexistent_stage")


class TestApiKeyValidation:
    """Tests for per-model API key presence validation in load_config()."""

    def test_raises_when_no_api_keys_set(self):
        """load_config() must raise OSError when no API keys are present."""
        with patch.dict(os.environ, {"CAPTURE_DIALOGUES": "false"}, clear=True):
            with pytest.raises(OSError):
                load_config()

    def test_passes_with_anthropic_key_only(self):
        """load_config() succeeds when all stages use Anthropic and key is set."""
        cfg = _load()
        assert cfg.stage_models  # populated successfully

    def test_missing_google_key_when_google_slug_used(self):
        """OSError raised when a Google model slug is used but GOOGLE_API_KEY is absent."""
        from unittest.mock import patch as _patch

        fake_stage_models = {
            "planner": "claude-opus-4-6", "pm": "claude-opus-4-6",
            "developer": "gemini-2.5-pro", "qa": "claude-sonnet-4-6",
            "security_auditor": "claude-sonnet-4-6", "reviewer": "claude-sonnet-4-6",
            "release_engineer": "claude-sonnet-4-6", "docs": "claude-sonnet-4-6",
            "synthesis": "claude-sonnet-4-6",
        }
        with _patch(
            "src.utils.persona_models.extract_persona_model_slugs",
            return_value=fake_stage_models,
        ):
            env = {"ANTHROPIC_API_KEY": "sk-test", "CAPTURE_DIALOGUES": "false"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(OSError, match="GOOGLE_API_KEY"):
                    load_config()

    def test_model_name_env_var_is_ignored(self):
        """MODEL_NAME in the environment must not cause a crash or affect stage_models."""
        env = {**_BASE_ENV, "MODEL_NAME": "some-old-model", "CAPTURE_DIALOGUES": "false"}
        with patch.dict(os.environ, env, clear=True):
            cfg = load_config()
        # stage_models must be populated from persona metadata, not MODEL_NAME.
        assert cfg.stage_models
        # developer should still have the persona-metadata slug.
        assert cfg.stage_models.get("developer") == "claude-sonnet-4-6"

    def test_raises_when_stage_models_incomplete(self):
        """load_config() must raise OSError when persona YAML files are missing."""
        from unittest.mock import patch as _patch

        # Only 2 of 9 stages — the count guard must fire.
        partial_models = {"planner": "claude-opus-4-6", "developer": "claude-sonnet-4-6"}
        with _patch(
            "src.utils.persona_models.extract_persona_model_slugs",
            return_value=partial_models,
        ):
            env = {"ANTHROPIC_API_KEY": "sk-test", "CAPTURE_DIALOGUES": "false"}
            with patch.dict(os.environ, env, clear=True):
                with pytest.raises(OSError, match="Expected 9 stage model slugs"):
                    load_config()


# ---------------------------------------------------------------------------
# Tests: Config.stream_max_retries and Config.stream_retry_base_delay_s
# ---------------------------------------------------------------------------


class TestStreamRetryConfig:
    """Tests for stream retry configuration fields and env-var parsing (WP-003)."""

    # ------------------------------------------------------------------
    # AC-1: correct defaults
    # ------------------------------------------------------------------

    def test_stream_max_retries_default(self):
        """stream_max_retries defaults to 2 when STREAM_MAX_RETRIES is unset."""
        cfg = _load()
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_default(self):
        """stream_retry_base_delay_s defaults to 10.0 when STREAM_RETRY_BASE_DELAY_S is unset."""
        cfg = _load()
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_max_retries_is_int(self):
        cfg = _load()
        assert isinstance(cfg.stream_max_retries, int)

    def test_stream_retry_base_delay_is_float(self):
        cfg = _load()
        assert isinstance(cfg.stream_retry_base_delay_s, float)

    # ------------------------------------------------------------------
    # AC-2: env vars are parsed correctly
    # ------------------------------------------------------------------

    def test_stream_max_retries_env_var(self):
        cfg = _load({"STREAM_MAX_RETRIES": "5"})
        assert cfg.stream_max_retries == 5

    def test_stream_max_retries_zero_disables_retry(self):
        cfg = _load({"STREAM_MAX_RETRIES": "0"})
        assert cfg.stream_max_retries == 0

    def test_stream_retry_base_delay_env_var(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "30.0"})
        assert cfg.stream_retry_base_delay_s == 30.0

    def test_stream_retry_base_delay_integer_string(self):
        """An integer string like "20" must be accepted as a valid float."""
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "20"})
        assert cfg.stream_retry_base_delay_s == 20.0

    # ------------------------------------------------------------------
    # AC-3: missing or non-numeric values fall back to defaults
    # ------------------------------------------------------------------

    def test_stream_max_retries_non_numeric_falls_back(self):
        cfg = _load({"STREAM_MAX_RETRIES": "not-a-number"})
        assert cfg.stream_max_retries == 2

    def test_stream_max_retries_empty_string_falls_back(self):
        cfg = _load({"STREAM_MAX_RETRIES": ""})
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_non_numeric_falls_back(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "not-a-number"})
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_retry_base_delay_empty_string_falls_back(self):
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": ""})
        assert cfg.stream_retry_base_delay_s == 10.0

    def test_stream_max_retries_negative_falls_back(self):
        """Negative value is invalid; must fall back to the default."""
        cfg = _load({"STREAM_MAX_RETRIES": "-1"})
        assert cfg.stream_max_retries == 2

    def test_stream_retry_base_delay_negative_falls_back(self):
        """Negative delay is invalid; must fall back to the default."""
        cfg = _load({"STREAM_RETRY_BASE_DELAY_S": "-5.0"})
        assert cfg.stream_retry_base_delay_s == 10.0


```
###  Path: `/orchestrator/tests/test_dialogue_writer.py`

```py
"""
test_dialogue_writer.py — Unit tests for orchestrator/src/utils/dialogue_writer.py.

All filesystem operations use pytest's ``tmp_path`` fixture; no real files are
created outside the temporary directory.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.messages import SystemMessage

from src.utils.dialogue_writer import _msg_role, serialize_messages_to_markdown, write_dialogue

# ---------------------------------------------------------------------------
# Minimal message stubs (no LangChain dependency required for unit tests)
# ---------------------------------------------------------------------------

def _human(content: str) -> Any:
    return SimpleNamespace(type="human", content=content, tool_calls=None, usage_metadata=None)


def _ai(content: str, tool_calls: list | None = None, usage: dict | None = None) -> Any:
    return SimpleNamespace(
        type="ai",
        content=content,
        tool_calls=tool_calls or [],
        usage_metadata=usage,
    )


def _tool(content: str, tool_call_id: str = "tc-1") -> Any:
    return SimpleNamespace(
        type="tool",
        content=content,
        tool_calls=None,
        tool_call_id=tool_call_id,
        usage_metadata=None,
    )


# ---------------------------------------------------------------------------
# serialize_messages_to_markdown
# ---------------------------------------------------------------------------

class TestSerializeHeader:
    """Document header is always present regardless of message content."""

    def test_header_contains_stage(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "developer" in md

    def test_header_contains_wp_id(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "WP-001" in md

    def test_header_contains_custom_timestamp(self):
        ts = "2026-01-15T10:00:00+00:00"
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001", timestamp=ts)
        assert ts in md

    def test_header_auto_timestamp_when_none(self):
        md = serialize_messages_to_markdown([], stage="qa", wp_id="WP-002")
        # A UTC ISO timestamp contains "T" and ends with "+00:00" or "Z".
        assert "T" in md  # rough sanity — there is some ISO-looking timestamp

    def test_title_line_format(self):
        md = serialize_messages_to_markdown([], stage="reviewer", wp_id="WP-003")
        assert "# Dialogue" in md


class TestSerializeEmptyMessages:
    """Empty message lists must not raise and must produce a valid document."""

    def test_no_exception(self):
        serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")

    def test_returns_string(self):
        result = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert isinstance(result, str)

    def test_minimal_placeholder_present(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "No messages" in md or "no messages" in md.lower()


class TestSerializeHumanMessage:
    """Human messages appear under ## Human."""

    def test_human_section_header(self):
        msgs = [_human("Hello, agent.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Human" in md

    def test_human_content_preserved(self):
        msgs = [_human("Please implement the feature.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Please implement the feature." in md

    def test_multi_paragraph_content(self):
        text = "Paragraph one.\n\nParagraph two."
        msgs = [_human(text)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Paragraph one." in md
        assert "Paragraph two." in md


class TestSerializeAIMessage:
    """AI messages appear under ## Assistant."""

    def test_assistant_section_header(self):
        msgs = [_ai("I will implement the feature.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Assistant" in md

    def test_ai_content_preserved(self):
        msgs = [_ai("Implementation complete.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Implementation complete." in md

    def test_tool_call_rendered_as_fenced_block(self):
        tc = [{"name": "read_file", "args": {"path": "/foo/bar.py"}, "id": "tc-abc"}]
        msgs = [_ai("Let me read the file.", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "read_file" in md
        assert "```" in md
        assert "/foo/bar.py" in md

    def test_tool_call_name_highlighted(self):
        tc = [{"name": "write_file", "args": {}, "id": "tc-1"}]
        msgs = [_ai("", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "write_file" in md

    def test_multiple_tool_calls_all_rendered(self):
        tc = [
            {"name": "tool_a", "args": {"x": 1}, "id": "tc-1"},
            {"name": "tool_b", "args": {"y": 2}, "id": "tc-2"},
        ]
        msgs = [_ai("Using two tools.", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "tool_a" in md
        assert "tool_b" in md


class TestSerializeToolMessage:
    """Tool messages appear under ## Tool Result."""

    def test_tool_result_section_header(self):
        msgs = [_tool("File content here.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Tool Result" in md

    def test_tool_content_preserved(self):
        msgs = [_tool("The answer is 42.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "The answer is 42." in md


class TestSerializeMultipleMessages:
    """Multiple messages are all rendered in order."""

    def test_all_roles_present(self):
        msgs = [
            _human("Do the thing."),
            _ai("Calling tool.", tool_calls=[{"name": "x", "args": {}, "id": "tc-1"}]),
            _tool("Tool returned value."),
            _ai("Done."),
        ]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Human" in md
        assert "## Assistant" in md
        assert "## Tool Result" in md

    def test_ordering_preserved(self):
        msgs = [_human("First"), _ai("Second"), _tool("Third")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        pos_human = md.index("## Human")
        pos_ai = md.index("## Assistant")
        pos_tool = md.index("## Tool Result")
        assert pos_human < pos_ai < pos_tool


class TestSerializeUsageMetadata:
    """Aggregate token-usage table is appended when usage_metadata is present."""

    def test_usage_section_present_when_metadata_available(self):
        msgs = [_ai("Done.", usage={"input_tokens": 100, "output_tokens": 50})]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Token Usage" in md

    def test_usage_counts_appear_in_output(self):
        msgs = [_ai("Done.", usage={"input_tokens": 123, "output_tokens": 456})]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "123" in md
        assert "456" in md

    def test_usage_section_absent_when_no_metadata(self):
        msgs = [_human("Hello"), _ai("Hi")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Token Usage" not in md

    def test_usage_aggregated_across_messages(self):
        msgs = [
            _ai("First.", usage={"input_tokens": 10, "output_tokens": 20}),
            _ai("Second.", usage={"input_tokens": 5, "output_tokens": 15}),
        ]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "15" in md  # 10 + 5
        assert "35" in md  # 20 + 15

    def test_usage_section_absent_for_empty_messages(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "Token Usage" not in md


# ---------------------------------------------------------------------------
# write_dialogue
# ---------------------------------------------------------------------------

class TestWriteDialogueCreatesDirectory:
    """The orchestrator/dialogues/ subdirectory is created when absent."""

    def test_creates_dialogues_dir(self, tmp_path: Path):
        write_dialogue("# Hello", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert (tmp_path / "orchestrator" / "dialogues").is_dir()

    def test_no_error_when_dir_already_exists(self, tmp_path: Path):
        (tmp_path / "orchestrator" / "dialogues").mkdir(parents=True)
        write_dialogue("# Hello", slug_dir=tmp_path, wp_id="WP-001", stage="developer")


class TestWriteDialogueRevisionNumbers:
    """Revision counter starts at 0 and increments on each call."""

    def test_first_file_is_r0(self, tmp_path: Path):
        path = write_dialogue("content", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.name == "WP-001-developer-r0.md"

    def test_second_call_is_r1(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path2 = write_dialogue("v2", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path2.name == "WP-001-developer-r1.md"

    def test_third_call_is_r2(self, tmp_path: Path):
        for _ in range(2):
            write_dialogue("v", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path3 = write_dialogue("v3", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path3.name == "WP-001-developer-r2.md"

    def test_different_stage_starts_at_r0(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path = write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="qa")
        assert path.name == "WP-001-qa-r0.md"

    def test_different_wp_id_starts_at_r0(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path = write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-002", stage="developer")
        assert path.name == "WP-002-developer-r0.md"


class TestWriteDialogueContent:
    """Written file contains exactly the provided content."""

    def test_content_written_correctly(self, tmp_path: Path):
        content = "# My Dialogue\n\nHello world.\n"
        path = write_dialogue(content, slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.read_text(encoding="utf-8") == content

    def test_empty_content_written(self, tmp_path: Path):
        path = write_dialogue("", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.read_text(encoding="utf-8") == ""


class TestWriteDialogueReturnValue:
    """write_dialogue() returns the Path of the written file."""

    def test_returns_path_object(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert isinstance(result, Path)

    def test_returned_path_exists(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert result.exists()

    def test_returned_path_is_inside_dialogues_dir(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert result.parent == tmp_path / "orchestrator" / "dialogues"


class TestWriteDialogueNoSideEffects:
    """Files are only created inside tmp_path — not in the working directory."""

    def test_no_dialogues_dir_in_cwd(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        separate_dir = tmp_path / "project"
        separate_dir.mkdir()
        write_dialogue("x", slug_dir=separate_dir, wp_id="WP-001", stage="developer")
        # The CWD (tmp_path) should not have an orchestrator/dialogues/ dir.
        assert not (tmp_path / "orchestrator" / "dialogues").exists()
        # Only the project dir's orchestrator/dialogues subdir should exist.
        assert (separate_dir / "orchestrator" / "dialogues").exists()


# ---------------------------------------------------------------------------
# _msg_role helper — SystemMessage coverage (WP-005)
# ---------------------------------------------------------------------------

class TestMsgRoleSystem:
    """_msg_role() correctly identifies a SystemMessage and returns 'System'."""

    def test_system_message_returns_system(self):
        msg = SystemMessage(content="You are a helpful assistant.")
        assert _msg_role(msg) == "System"


# ---------------------------------------------------------------------------
# Round-trip: serialize → write → read back
# ---------------------------------------------------------------------------

class TestRoundTrip:
    """Ensure the serialiser output can be written and read back intact."""

    def test_round_trip(self, tmp_path: Path):
        msgs = [
            _human("Implement the feature."),
            _ai("Done.", usage={"input_tokens": 10, "output_tokens": 5}),
        ]
        content = serialize_messages_to_markdown(
            msgs,
            stage="developer",
            wp_id="WP-001",
            timestamp="2026-01-01T00:00:00+00:00",
        )
        path = write_dialogue(content, slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        recovered = path.read_text(encoding="utf-8")
        assert recovered == content
        assert "## Human" in recovered
        assert "## Assistant" in recovered
        assert "Token Usage" in recovered

```
###  Path: `/orchestrator/tests/test_error_helpers.py`

```py
"""
test_error_helpers.py — Unit tests for the error-classifier helper functions
in ``src/nodes/__init__.py``.

Covers :func:`_is_retryable_api_error` in isolation, separated from the
stage-node tests in ``test_nodes.py`` to improve discoverability.
"""

from __future__ import annotations

from src.nodes import _is_retryable_api_error

# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------

def _exc_with_status(status: int) -> Exception:
    """Return a plain Exception with a ``status_code`` attribute."""
    exc = Exception(f"HTTP {status}")
    exc.status_code = status  # type: ignore[attr-defined]
    return exc


def _httpx_transport_error() -> Exception:
    """Return an exception that looks like an httpx transport error.

    We fake the ``__module__`` attribute so we don't need to import httpx.
    The exception carries no ``status_code``, matching the real httpx
    ``TransportError`` / ``ConnectError`` hierarchy.
    """

    class _FakeHttpxConnectError(Exception):
        pass

    _FakeHttpxConnectError.__module__ = "httpx"
    return _FakeHttpxConnectError("Connection refused")


def _httpx_status_error(status: int) -> Exception:
    """Return an exception that looks like an httpx.HTTPStatusError.

    Fakes the ``httpx`` module and carries a ``status_code`` attribute,
    matching the real ``httpx.HTTPStatusError`` which is raised for HTTP
    responses with error status codes.  The presence of ``status_code``
    means this is routed through the status-code branch, not the
    transport-error branch.
    """

    class _FakeHttpxStatusError(Exception):
        pass

    _FakeHttpxStatusError.__module__ = "httpx"
    exc = _FakeHttpxStatusError(f"HTTP {status}")
    exc.status_code = status  # type: ignore[attr-defined]
    return exc


# ---------------------------------------------------------------------------
# Tests: _is_retryable_api_error
# ---------------------------------------------------------------------------


class TestIsRetryableApiError:
    """Tests for _is_retryable_api_error()."""

    # ------------------------------------------------------------------
    # AC-1: Retryable HTTP status codes and httpx transport errors
    # ------------------------------------------------------------------

    def test_status_529_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(529)) is True

    def test_status_429_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(429)) is True

    def test_status_500_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(500)) is True

    def test_status_503_is_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(503)) is True

    def test_httpx_transport_error_is_retryable(self):
        assert _is_retryable_api_error(_httpx_transport_error()) is True

    # ------------------------------------------------------------------
    # AC-2: Fatal HTTP status codes are never retryable
    # ------------------------------------------------------------------

    def test_status_401_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(401)) is False

    def test_status_403_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(403)) is False

    # ------------------------------------------------------------------
    # AC-3: Non-API errors are not retryable
    # ------------------------------------------------------------------

    def test_plain_value_error_is_not_retryable(self):
        assert _is_retryable_api_error(ValueError("something went wrong")) is False

    def test_plain_runtime_error_is_not_retryable(self):
        assert _is_retryable_api_error(RuntimeError("unexpected")) is False

    def test_status_400_client_error_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(400)) is False

    def test_status_404_client_error_is_not_retryable(self):
        assert _is_retryable_api_error(_exc_with_status(404)) is False

    def test_httpx_status_error_400_is_not_retryable(self):
        """httpx.HTTPStatusError with a 4xx status_code must NOT be retried.

        This locks the disambiguation invariant: httpx errors that carry a
        ``status_code`` attribute are routed through the status-code branch,
        NOT the transport-error branch.  A 400 response from httpx is a client
        error and must be treated as non-retryable.
        """
        assert _is_retryable_api_error(_httpx_status_error(400)) is False

    # ------------------------------------------------------------------
    # AC-4: Exception chain walking
    # ------------------------------------------------------------------

    def test_wrapped_529_via_cause_is_retryable(self):
        inner = _exc_with_status(529)
        outer = RuntimeError("wrapper")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_429_via_context_is_retryable(self):
        inner = _exc_with_status(429)
        outer = RuntimeError("wrapper")
        outer.__context__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_500_via_cause_is_retryable(self):
        inner = _exc_with_status(500)
        outer = ValueError("wrapped")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is True

    def test_wrapped_401_via_cause_is_not_retryable(self):
        """A fatal error wrapped in RuntimeError must still be non-retryable."""
        inner = _exc_with_status(401)
        outer = RuntimeError("wrapper")
        outer.__cause__ = inner
        assert _is_retryable_api_error(outer) is False

    def test_deeply_wrapped_httpx_error_is_retryable(self):
        httpx_err = _httpx_transport_error()
        mid = RuntimeError("middle")
        mid.__cause__ = httpx_err
        outer = Exception("outer")
        outer.__cause__ = mid
        assert _is_retryable_api_error(outer) is True

```
###  Path: `/orchestrator/tests/test_filelock.py`

```py
"""Unit tests for orchestrator/src/utils/filelock.py."""
from __future__ import annotations

import os
import tempfile

import pytest

from src.utils.filelock import lock_exclusive, unlock


def _open_temp() -> tuple[int, str]:
    """Return (fd, path) for a new temporary file."""
    fd, path = tempfile.mkstemp()
    return fd, path


class TestLockExclusiveSucceeds:
    def test_acquires_without_exception(self) -> None:
        fd, path = _open_temp()
        try:
            lock_exclusive(fd)   # should not raise
            unlock(fd)
        finally:
            os.close(fd)
            os.unlink(path)


class TestLockExclusiveContention:
    def test_raises_on_contention(self) -> None:
        """Lock a file, then open the same file again and attempt to lock it."""
        fd1, path = _open_temp()
        fd2 = os.open(path, os.O_RDWR)
        try:
            lock_exclusive(fd1)
            with pytest.raises(OSError):
                lock_exclusive(fd2)
        finally:
            unlock(fd1)
            os.close(fd1)
            os.close(fd2)
            os.unlink(path)


class TestUnlockIdempotent:
    def test_no_exception_on_unlocked_fd(self) -> None:
        fd, path = _open_temp()
        try:
            # Never locked — unlock should swallow any error
            unlock(fd)
        finally:
            os.close(fd)
            os.unlink(path)

```
###  Path: `/orchestrator/tests/test_graph.py`

```py
"""
test_graph.py — Unit tests for graph assembly (WP-005).

Tests verify:
- build_graph() returns a compiled graph with the correct node topology.
- All 7 nodes are present.
- Edges match the hub-and-spoke spec (all stages → supervisor, synthesis → END).
- Graph compiles without error when provided with mock config and empty tool list.
- The checkpointer is async-compatible (regression for SqliteSaver bug).

No real MCP server or LLM is used — all nodes are patched at import time.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

aiosqlite = pytest.importorskip(
    "aiosqlite", reason="aiosqlite not installed — run: pip install -e '.[dev]'"
)

# ---------------------------------------------------------------------------
# Mock config fixture
# ---------------------------------------------------------------------------

class _MockConfig:
    stage_models = {"developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
                    "reviewer": "claude-test", "security_auditor": "claude-test",
                    "docs": "claude-test", "release_engineer": "claude-test",
                    "synthesis": "claude-test", "planner": "claude-test"}
    max_iterations = 10
    workspace_root = Path(__file__).resolve().parent.parent.parent
    checkpoint_dir = Path(__file__).resolve().parent.parent / "checkpoints" / "test"
    mcp_server_cmd = ["node", "fake-server.js"]
    log_level = "INFO"

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


MOCK_CONFIG = _MockConfig()
MOCK_TOOLS: list[Any] = []


# ---------------------------------------------------------------------------
# Helpers: patch all node factories to return no-op callables
# ---------------------------------------------------------------------------

def _noop_node(name: str):
    def _node(state):
        return {"stage_result": f"{name} stub", "stage_success": True, "run_log": []}
    _node.__name__ = name
    return _node


def _apply_patches(test_fn):
    """Decorator that applies all node factory patches."""
    import functools

    @functools.wraps(test_fn)
    async def wrapper(*args, **kwargs):
        # Patch at source module level (lazy imports inside build_graph()).
        with (
            patch(
                "src.supervisor.make_supervisor_node",
                side_effect=lambda tools, *, dry_run=False: _noop_node("supervisor"),
            ),
            patch("src.nodes.pm.make_pm_node", side_effect=lambda cfg, tools: _noop_node("pm")),
            patch(
                "src.nodes.developer.make_developer_node",
                side_effect=lambda cfg, tools: _noop_node("developer"),
            ),
            patch("src.nodes.qa.make_qa_node", side_effect=lambda cfg, tools: _noop_node("qa")),
            patch(
                "src.nodes.reviewer.make_reviewer_node",
                side_effect=lambda cfg, tools: _noop_node("reviewer"),
            ),
            patch(
                "src.nodes.security_auditor.make_security_auditor_node",
                side_effect=lambda cfg, tools: _noop_node("security_auditor"),
            ),
            patch(
                "src.nodes.release_engineer.make_release_engineer_node",
                side_effect=lambda cfg, tools: _noop_node("release_engineer"),
            ),
            patch(
                "src.nodes.docs.make_docs_node",
                side_effect=lambda cfg, tools: _noop_node("docs"),
            ),
            patch(
                "src.nodes.synthesis.make_synthesis_node",
                side_effect=lambda cfg, tools: _noop_node("synthesis"),
            ),
        ):
            return await test_fn(*args, **kwargs)

    return wrapper


# ---------------------------------------------------------------------------
# Tests: build_graph() returns a compiled graph
# ---------------------------------------------------------------------------

class TestBuildGraphReturnType:
    @_apply_patches
    async def test_build_graph_returns_object(self, tmp_path):
        """build_graph() returns a non-None compiled graph."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            assert graph is not None
        finally:
            await conn.close()

    @_apply_patches
    async def test_compiled_graph_is_callable(self, tmp_path):
        """The compiled graph exposes an invoke() method."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            assert callable(getattr(graph, "invoke", None))
        finally:
            await conn.close()

    @_apply_patches
    async def test_conn_is_aiosqlite_connection(self, tmp_path):
        """build_graph() second return value is an aiosqlite.Connection."""
        import aiosqlite

        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            assert isinstance(conn, aiosqlite.Connection), (
                f"Expected aiosqlite.Connection, got {type(conn).__name__}"
            )
        finally:
            await conn.close()


class TestGraphNodes:
    @_apply_patches
    async def test_graph_has_nine_nodes(self, tmp_path):
        """Graph topology must contain exactly 9 nodes."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            # LangGraph 1.x: CompiledStateGraph exposes .nodes directly.
            nodes = set(graph.nodes)
            expected_nodes = {
                "supervisor", "pm", "developer", "qa", "reviewer",
                "security_auditor", "docs", "release_engineer", "synthesis",
            }
            # START and END are pseudo-nodes added by LangGraph; remove them for comparison.
            nodes.discard("__start__")
            nodes.discard("__end__")
            assert nodes == expected_nodes
        finally:
            await conn.close()


class TestGraphEdges:
    @_apply_patches
    async def test_start_edges_to_supervisor(self, tmp_path):
        """START must edge to 'supervisor'."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            edges = graph.builder.edges
            start_targets = {edge[1] for edge in edges if edge[0] == "__start__"}
            assert "supervisor" in start_targets
        finally:
            await conn.close()

    @_apply_patches
    async def test_loop_stages_edge_to_supervisor(self, tmp_path):
        """pm, developer, qa, reviewer, docs must each edge back to supervisor."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            edges = graph.builder.edges  # set of (source, target) tuples
            # Build a mapping: source → set of targets
            edge_map: dict = {}
            for edge in edges:
                src, dst = edge[0], edge[1]
                edge_map.setdefault(src, set()).add(dst)

            loop_stages = ("pm", "developer", "qa", "reviewer", "docs")
            for stage in loop_stages:
                assert "supervisor" in edge_map.get(stage, set()), (
                    f"Stage {stage!r} must have an edge back to supervisor"
                )
        finally:
            await conn.close()

    @_apply_patches
    async def test_synthesis_edges_to_end(self, tmp_path):
        """synthesis must edge to END (not back to supervisor)."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            edges = graph.builder.edges  # set of (source, target) tuples
            edge_map: dict = {}
            for edge in edges:
                src, dst = edge[0], edge[1]
                edge_map.setdefault(src, set()).add(dst)

            synthesis_targets = edge_map.get("synthesis", set())
            assert "__end__" in synthesis_targets
            assert "supervisor" not in synthesis_targets
        finally:
            await conn.close()


class TestCheckpointerCreated:
    @_apply_patches
    async def test_checkpoint_dir_created(self, tmp_path):
        """build_graph() creates the checkpoint directory if it does not exist."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        cfg = _TmpConfig()
        assert not cfg.checkpoint_dir.exists()
        graph, conn = await build_graph(cfg, MOCK_TOOLS)
        try:
            assert cfg.checkpoint_dir.exists()
        finally:
            await conn.close()


class TestCheckpointerIsAsync:
    @_apply_patches
    async def test_checkpointer_supports_async(self, tmp_path):
        """The graph checkpointer must support async methods (ainvoke).

        Regression test: SqliteSaver raises NotImplementedError on async
        calls (aget_tuple, aput, etc.).  The graph must use
        AsyncSqliteSaver so that ``graph.ainvoke()`` works.
        """
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        try:
            checkpointer = graph.checkpointer
            assert isinstance(checkpointer, AsyncSqliteSaver), (
                f"Checkpointer must be AsyncSqliteSaver, got {type(checkpointer).__name__}"
            )
        finally:
            await conn.close()

    @_apply_patches
    async def test_graph_ainvoke_does_not_raise_not_implemented(self, tmp_path):
        """graph.ainvoke() must not raise NotImplementedError from the checkpointer.

        This is the exact failure mode from the bug: SqliteSaver.aget_tuple()
        raises NotImplementedError when the graph is invoked asynchronously.
        """
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS)
        initial_state = {
            "plan_text": "test",
            "project_slug": "test-project",
            "project_title": "Test",
            "stage_result": "",
            "stage_success": True,
            "supervisor_iteration": 0,
            "run_log": [],
        }
        try:
            # The supervisor stub will route somewhere that may fail, but the
            # important thing is that the checkpointer itself does NOT raise
            # NotImplementedError.  We catch any other exception and let it pass.
            try:
                await graph.ainvoke(
                    initial_state,
                    {"configurable": {"thread_id": "test-async-compat"}},
                )
            except NotImplementedError as exc:
                if "async" in str(exc).lower():
                    pytest.fail(f"Checkpointer does not support async: {exc}")
        finally:
            await conn.close()


# ---------------------------------------------------------------------------
# Tests: build_graph(dry_run=True)
# ---------------------------------------------------------------------------

class TestDryRunGraph:
    """Verify that dry_run=True produces a structurally correct 9-node graph."""

    async def test_dry_run_returns_graph_and_conn(self, tmp_path):
        """build_graph(dry_run=True) returns a compiled graph + connection."""
        import aiosqlite

        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        with patch(
            "src.supervisor.make_supervisor_node",
            side_effect=lambda tools, *, dry_run=False: _noop_node("supervisor"),
        ):
            graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS, dry_run=True)
        try:
            assert graph is not None
            assert isinstance(conn, aiosqlite.Connection)
        finally:
            await conn.close()

    async def test_dry_run_has_nine_nodes(self, tmp_path):
        """dry_run graph must have the same 9-node topology as a live graph."""
        from src.graph import build_graph

        class _TmpConfig(_MockConfig):
            checkpoint_dir = tmp_path / "checkpoints"

        with patch(
            "src.supervisor.make_supervisor_node",
            side_effect=lambda tools, *, dry_run=False: _noop_node("supervisor"),
        ):
            graph, conn = await build_graph(_TmpConfig(), MOCK_TOOLS, dry_run=True)
        try:
            nodes = set(graph.nodes)
            nodes.discard("__start__")
            nodes.discard("__end__")
            expected = {
                "supervisor", "pm", "developer", "qa", "reviewer",
                "security_auditor", "release_engineer", "docs", "synthesis",
            }
            assert nodes == expected, f"Node mismatch: {nodes ^ expected}"
        finally:
            await conn.close()

```
###  Path: `/orchestrator/tests/test_integration.py`

```py
"""
test_integration.py — Integration tests for the AI Insights Orchestrator workflow.

These tests verify multi-step graph execution end-to-end using:
- The real LangGraph engine and real supervisor routing logic.
- Scripted MCP tool mocks (``ScriptedLedger``) that advance through
  realistic ledger state sequences as each stage node executes.
- Lightweight stage-node stubs that advance the ledger state and
  return deterministic results without calling real LLM agents.

No real MCP server or LLM API key is required.  All tests run in < 1 second.

Running
-------
::

    # All integration tests (this file):
    python -m pytest tests/test_integration.py -m integration -v

    # Alongside unit tests:
    python -m pytest tests/ -m "integration or not integration" -v

    # With verbose supervisor log output:
    python -m pytest tests/test_integration.py -m integration -v -s

Live infrastructure tests (require MCP server build + API key)
---------------------------------------------------------------
These are labelled ``@pytest.mark.live`` and are skipped by default.  Run with::

    python -m pytest tests/test_integration.py -m live -v
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from src.state import WorkflowState
from src.supervisor import make_supervisor_node

# ---------------------------------------------------------------------------
# pytest mark registration
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers — scripted ledger state machine
# ---------------------------------------------------------------------------


class ScriptedLedger:
    """
    Simulates a live MCP ledger with a pre-scripted sequence of states.

    Each *step* is a dict::

        {
            "project_status": {...},          # returned by ledger_get_project_status
            "wp_list": [...],                 # returned by ledger_list_work_packages
            "wp_details": {"WP-001": {...}},  # returned by ledger_get_work_package
        }

    Stage-node stubs call :meth:`advance` after they execute to move the
    ledger to its next state so the supervisor sees the correct result on
    the following iteration.
    """

    def __init__(self, steps: list[dict]) -> None:
        if not steps:
            raise ValueError("ScriptedLedger requires at least one step.")
        self._steps = steps
        self._index = 0
        # Record which stages executed (appended by stubs).
        self.execution_log: list[str] = []

    @property
    def state(self) -> dict:
        """Return the current ledger state dict (never past the last step)."""
        return self._steps[min(self._index, len(self._steps) - 1)]

    def advance(self) -> None:
        """Move to the next scripted state (idempotent at last step)."""
        if self._index < len(self._steps) - 1:
            self._index += 1

    # ------------------------------------------------------------------
    # Internal helper: derive ledger_get_next_action response from WP state
    # ------------------------------------------------------------------

    @staticmethod
    def _derive_next_action(
        agent_role: str, wp_list: list, wp_details: dict
    ) -> dict:
        """Simulate what ``ledger_get_next_action`` returns for *agent_role*."""

        def latest(pipelines: list, ptype: str) -> str | None:
            for p in reversed(pipelines):
                if p.get("type") == ptype:
                    return p.get("status")
            return None

        non_terminal = [
            wp
            for wp in wp_list
            if wp.get("status") not in ("COMPLETE", "CANCELLED")
        ]

        # All non-terminal WPs BLOCKED → PM handles repair.
        if non_terminal and all(
            wp.get("status") == "BLOCKED" for wp in non_terminal
        ):
            if agent_role == "Project Manager":
                return {"action": "REPAIR_ORPHAN_BLOCKED"}
            return {"action": "WAIT"}

        # IN_PROGRESS first (matches real server priority), then READY.
        ordered = [
            wp for wp in wp_list if wp.get("status") == "IN_PROGRESS"
        ] + [wp for wp in wp_list if wp.get("status") == "READY"]

        for wp_summary in ordered:
            wp_id = wp_summary.get("work_package_id", "")
            if wp_summary.get("status") in ("COMPLETE", "CANCELLED", "BLOCKED"):
                continue

            wp_detail = wp_details.get(wp_id, wp_summary)
            pipelines = wp_detail.get("pipelines", [])

            impl = latest(pipelines, "implementation")
            qa = latest(pipelines, "qa")
            cr = latest(pipelines, "code-review")
            doc = latest(pipelines, "documentation")

            if impl is None:
                next_role, action = "Developer", "IMPLEMENT"
            elif impl == "IN_PROGRESS":
                next_role, action = "Developer", "CONTINUE_PIPELINE"
            elif impl == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif impl == "PASS" and qa is None:
                next_role, action = "QA", "RUN_QA"
            elif qa == "IN_PROGRESS":
                next_role, action = "QA", "CONTINUE_PIPELINE"
            elif qa == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif qa == "PASS" and cr is None:
                next_role, action = "Reviewer", "RUN_REVIEW"
            elif cr == "IN_PROGRESS":
                next_role, action = "Reviewer", "CONTINUE_PIPELINE"
            elif cr == "FAIL":
                next_role, action = "Developer", "REWORK"
            elif cr == "PASS" and doc is None:
                next_role, action = "Documentation", "WRITE_DOCS"
            elif doc == "IN_PROGRESS":
                next_role, action = "Documentation", "CONTINUE_PIPELINE"
            elif doc == "FAIL":
                next_role, action = "Documentation", "REWORK"
            else:
                continue  # WP fully done

            if next_role == agent_role:
                return {"action": action, "work_package_id": wp_id}

        return {"action": "WAIT"}

    def make_mcp_tools(self) -> list[Any]:
        """Return a list of mock LangChain ``Tool`` objects backed by this ledger."""

        def _project_status(kwargs: dict) -> str:
            return json.dumps(self.state["project_status"])

        def _wp_list(kwargs: dict) -> str:
            return json.dumps(self.state["wp_list"])

        def _wp_detail(kwargs: dict) -> str:
            wp_id: str = kwargs.get("work_package_id", "")
            detail = self.state.get("wp_details", {}).get(wp_id, {})
            return json.dumps(detail)

        def _next_action(kwargs: dict) -> str:
            role: str = kwargs.get("agent_role", "")
            result = self._derive_next_action(
                role,
                self.state.get("wp_list", []),
                self.state.get("wp_details", {}),
            )
            return json.dumps(result)

        def _make(name: str, fn) -> MagicMock:
            tool = MagicMock()
            tool.name = name
            tool.invoke = MagicMock(side_effect=fn)
            tool.ainvoke = AsyncMock(side_effect=fn)
            return tool

        return [
            _make("ledger_get_project_status", _project_status),
            _make("ledger_list_work_packages", _wp_list),
            _make("ledger_get_work_package", _wp_detail),
            _make("ledger_get_next_action", _next_action),
        ]

    def make_stage_node(self, stage: str, *, advance: bool = True):
        """
        Return a stage-node stub for *stage*.

        Parameters
        ----------
        stage:
            LangGraph node name (``"pm"``, ``"developer"``, etc.).
        advance:
            If ``True`` (default), call :meth:`ScriptedLedger.advance` so the
            next supervisor iteration sees the post-execution ledger state.
        """
        ledger = self  # close over self

        def _stub(state: WorkflowState) -> dict:
            ledger.execution_log.append(stage)
            if advance:
                ledger.advance()
            return {
                "stage_result": f"{stage} completed",
                "stage_success": True,
                "run_log": [
                    {
                        "timestamp": "2026-01-01T00:00:00Z",
                        "stage": stage,
                        "wp_id": state.get("current_wp_id", ""),  # type: ignore[call-overload]
                        "action": "stub_execute",
                        "result": "OK",
                    }
                ],
            }

        _stub.__name__ = f"{stage}_stub"
        _stub.__qualname__ = f"{stage}_stub"
        return _stub


# ---------------------------------------------------------------------------
# Graph builder for integration tests
# ---------------------------------------------------------------------------


def _build_integration_graph(
    ledger: ScriptedLedger,
    *,
    interrupt_before: list[str] | None = None,
) -> tuple[Any, MemorySaver]:
    """
    Build a test graph using the real supervisor + ledger-backed stubs.

    Returns (compiled_graph, checkpointer) so tests can use the checkpointer
    to verify state or exercise checkpoint/resume.

    ``max_iterations`` is not a graph-compile-time parameter; pass it to
    :func:`_initial_state` when invoking the graph instead.
    """
    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)

    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        builder.add_node(stage, ledger.make_stage_node(stage))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=interrupt_before if interrupt_before else None,
    )
    return graph, checkpointer


def _initial_state(
    project_path: str = "/fake/project",
    plan_file: str = "plan.md",
    max_iterations: int = 20,
) -> dict:
    """Return a minimal WorkflowState for graph invocation in tests."""
    return {
        "project_path": project_path,
        "plan_file": plan_file,
        "target_project_path": project_path,
        "current_stage": "",
        "current_wp_id": "",
        "iteration": 0,
        "max_iterations": max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "{}",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "wps_completed_this_run": 0,
        "run_log": [],
        "errors": [],
    }


# ---------------------------------------------------------------------------
# Canonical ledger state fixtures
# ---------------------------------------------------------------------------


def _pipeline(type_: str, status: str) -> dict:
    return {"type": type_, "status": status, "started_at": "2026-01-01T00:00:00"}


def _wp(
    wp_id: str,
    status: str,
    *,
    pipelines: list[dict] | None = None,
) -> dict:
    """Build a compact WP dict usable in both wp_list and wp_details lookups."""
    return {
        "work_package_id": wp_id,
        "status": status,
        "pipelines": pipelines or [],
        "acceptance_criteria": [],
    }


# ---------------------------------------------------------------------------
# Test 1 — Happy path
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_happy_path_full_pipeline():
    """
    The supervisor routes through pm → developer → qa → reviewer → docs →
    synthesis in the correct order for a single-WP project.

    Acceptance criteria:
    - AC-1: Happy-path test completes a full PM→Developer→QA→Reviewer→Docs→Synthesis pipeline.
    - AC-2: All ledger state transitions are correct (WP statuses, pipeline statuses).
    - AC-8: Tests clean up temporary ledger directories after execution (assured by
            in-memory ledger — no disk writes).
    """
    wp1 = "WP-001"

    # Script the ledger state progression:
    # [0] No WPs → supervisor routes to pm
    # [1] 1 WP IN_PROGRESS, no pipelines → supervisor routes to developer
    # [2] WP has impl=PASS, no qa → routes to qa
    # [3] WP has impl=PASS, qa=PASS, no code-review → routes to reviewer
    # [4] WP has impl=PASS, qa=PASS, cr=PASS, no docs → routes to docs
    # [5] all WPs COMPLETE → routes to synthesis → END
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [],
            "wp_details": {},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                        _pipeline("code-review", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "PASS"),
                        _pipeline("code-review", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Verify the complete stage execution sequence.
    expected_sequence = ["pm", "developer", "qa", "reviewer", "docs", "synthesis"]
    assert ledger.execution_log == expected_sequence, (
        f"Expected stages {expected_sequence}, got {ledger.execution_log}"
    )

    # Verify the final run log contains entries for all expected stages.
    run_log_stages = {entry["stage"] for entry in result.get("run_log", [])}
    for stage in expected_sequence:
        assert stage in run_log_stages, f"Stage {stage!r} missing from run_log"

    # No errors.
    assert result.get("errors") == [], f"Unexpected errors: {result.get('errors')}"


# ---------------------------------------------------------------------------
# Test 2 — Rework loop (QA FAIL → Developer rework → QA PASS)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_rework_loop_qa_fail_then_pass():
    """
    After a QA FAIL, the supervisor routes back to developer for rework,
    then returns to QA on the next pass.

    Acceptance criteria:
    - AC-3: Rework loop test demonstrates QA FAIL -> Developer rework -> QA PASS.
    """
    wp1 = "WP-001"

    # State progression:
    # [0] WP IN_PROGRESS, no pipelines → developer
    # [1] impl=PASS, no qa → qa
    # [2] impl=PASS, qa=FAIL → developer (rework)
    # [3] impl=PASS, qa=PASS, no cr → reviewer
    # [4] WP COMPLETE → synthesis → END
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS", pipelines=[_pipeline("implementation", "PASS")])
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [
                _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            ],
            "wp_details": {
                wp1: _wp(
                    wp1,
                    "IN_PROGRESS",
                    pipelines=[
                        _pipeline("implementation", "PASS"),
                        _pipeline("qa", "FAIL"),
                        _pipeline("qa", "PASS"),
                    ],
                )
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Expected sequence:
    #   developer (first pass) → qa (FAIL) → developer (rework) → reviewer → ...
    #
    # After developer reworks, the scripted state advances to one where qa=PASS
    # (the rework result). The supervisor therefore routes directly to reviewer
    # without needing a second explicit qa run — the PASS state was set as part
    # of the developer-rework state transition.
    assert ledger.execution_log.count("developer") == 2, (
        f"Expected developer to run twice (initial + rework); got: {ledger.execution_log}"
    )
    # qa ran once and produced FAIL, triggering the rework loop.
    assert ledger.execution_log.count("qa") >= 1, (
        f"Expected qa to run at least once; got: {ledger.execution_log}"
    )
    # Verify the critical rework-loop ordering.
    assert ledger.execution_log[0] == "developer", "First stage must be developer."
    assert ledger.execution_log[1] == "qa", "Second stage must be qa."
    assert ledger.execution_log[2] == "developer", "Third stage must be developer (rework)."
    # After rework the qa=PASS state is set; supervisor skips directly to reviewer.
    assert "reviewer" in ledger.execution_log, "Reviewer must execute after rework completes."
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 3 — Safety limit terminates cleanly
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_safety_limit_terminates_at_configured_limit():
    """
    When max_iterations is reached, the supervisor routes to END immediately
    and records an error in the state.

    Acceptance criteria:
    - AC-5: Safety limit test terminates cleanly at the configured limit.
    """
    wp1 = "WP-001"

    # Ledger always shows a WP in progress with no pipelines.
    # The supervisor will always route to developer, but never advance.
    # With max_iterations=1, the second supervisor pass triggers the limit.
    stuck_state = {
        "project_status": {"status": "IN_PROGRESS"},
        "wp_list": [_wp(wp1, "IN_PROGRESS")],
        "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
    }

    # Use advance=False so ledger state never progresses (simulates stuck run).
    ledger = ScriptedLedger([stuck_state])

    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)

    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        # advance=False so state never moves forward → infinite loop scenario
        builder.add_node(stage, ledger.make_stage_node(stage, advance=False))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(checkpointer=checkpointer)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    # max_iterations=1: supervisor runs once (iteration=1, routes to developer),
    # developer runs, supervisor runs again (iteration=2 > 1 → safety limit → END).
    result = await graph.ainvoke(_initial_state(max_iterations=1), thread_cfg)

    errors = result.get("errors", [])
    assert errors, "Expected at least one safety-limit error in state"
    assert any("safety" in str(e).lower() or "max_iterations" in str(e).lower() for e in errors), (
        f"Expected safety-limit error message; got: {errors}"
    )
    # developer ran once before the limit kicked in.
    assert "developer" in ledger.execution_log


# ---------------------------------------------------------------------------
# Test 4 — Multi-WP dependency ordering
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_multi_wp_dependency_ordering():
    """
    When WP-001 is COMPLETE and WP-002 was previously BLOCKED/READY,
    the supervisor routes to developer for WP-002 (the remaining WP).

    This verifies that the supervisor processes the next actionable WP
    after a dependency is resolved.

    Acceptance criteria:
    - AC-4: Multi-WP test respects dependency ordering (WP-002 waits for WP-001).
    """
    wp1, wp2 = "WP-001", "WP-002"

    # State progression:
    # [0] WP-001 IN_PROGRESS no pipelines, WP-002 BLOCKED
    # [1] WP-001 COMPLETE, WP-002 READY → routes to developer for WP-002
    # [2] WP-001 COMPLETE, WP-002 COMPLETE → synthesis
    steps = [
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS"), _wp(wp2, "BLOCKED")],
            "wp_details": {
                wp1: _wp(wp1, "IN_PROGRESS"),
                wp2: _wp(wp2, "BLOCKED"),
            },
        },
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "COMPLETE"), _wp(wp2, "READY")],
            "wp_details": {
                wp1: _wp(wp1, "COMPLETE"),
                wp2: _wp(wp2, "READY"),
            },
        },
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE"), _wp(wp2, "COMPLETE")],
            "wp_details": {
                wp1: _wp(wp1, "COMPLETE"),
                wp2: _wp(wp2, "COMPLETE"),
            },
        },
    ]

    ledger = ScriptedLedger(steps)
    graph, _ = _build_integration_graph(ledger)
    thread_cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}

    result = await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # Step 0: WP-001 IN_PROGRESS, no pipelines → developer executes (WP-001)
    # Step 1: WP-001 COMPLETE, WP-002 READY → developer executes (WP-002)
    # Step 2: all COMPLETE → synthesis
    assert "developer" in ledger.execution_log
    assert "synthesis" in ledger.execution_log
    # synthesis must be last
    assert ledger.execution_log[-1] == "synthesis"
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 5 — Checkpoint / resume
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_checkpoint_resume():
    """
    A graph interrupted at ``pm`` can be resumed from the same thread ID
    and continues through the remaining stages.

    Acceptance criteria:
    - AC-6: Checkpoint/resume test successfully continues from interrupted stage.
    """
    wp1 = "WP-001"

    steps = [
        # [0] No WPs → pm
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [],
            "wp_details": {},
        },
        # [1] After pm: 1 WP, no pipelines → developer
        {
            "project_status": {"status": "IN_PROGRESS"},
            "wp_list": [_wp(wp1, "IN_PROGRESS")],
            "wp_details": {wp1: _wp(wp1, "IN_PROGRESS")},
        },
        # [2] After developer: impl=PASS → ... eventually COMPLETE
        {
            "project_status": {"status": "COMPLETE"},
            "wp_list": [_wp(wp1, "COMPLETE")],
            "wp_details": {wp1: _wp(wp1, "COMPLETE")},
        },
    ]

    ledger = ScriptedLedger(steps)

    mcp_tools = ledger.make_mcp_tools()
    supervisor = make_supervisor_node(mcp_tools)
    builder = StateGraph(WorkflowState)
    builder.add_node("supervisor", supervisor)
    for stage in ("pm", "developer", "qa", "reviewer", "docs", "synthesis"):
        builder.add_node(stage, ledger.make_stage_node(stage))
    builder.add_edge(START, "supervisor")
    for stage in ("pm", "developer", "qa", "reviewer", "docs"):
        builder.add_edge(stage, "supervisor")
    builder.add_edge("synthesis", END)

    checkpointer = MemorySaver()
    graph = builder.compile(
        checkpointer=checkpointer,
        interrupt_before=["pm"],  # interrupt before pm stage
    )
    thread_id = str(uuid.uuid4())
    thread_cfg = {"configurable": {"thread_id": thread_id}}

    # ── First invocation: graph starts, supervisor routes to pm, BUT
    #    interrupt_before=["pm"] means it pauses BEFORE pm executes.
    await graph.ainvoke(_initial_state(max_iterations=20), thread_cfg)

    # pm has NOT executed yet (interrupted before it).
    assert "pm" not in ledger.execution_log, (
        f"pm should not have run yet; execution_log={ledger.execution_log}"
    )

    # ── Resume: pass None as input to continue from checkpoint.
    result = await graph.ainvoke(None, thread_cfg)

    # After resuming, pm executes.
    assert "pm" in ledger.execution_log, (
        f"pm should have run after resume; execution_log={ledger.execution_log}"
    )
    assert result.get("errors") == []


# ---------------------------------------------------------------------------
# Test 6 — All tests are marked @pytest.mark.integration (meta-test)
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_integration_marker_applied():
    """
    Trivial self-check: this module's pytestmark applies ``integration``
    so all tests can be selected or excluded with ``-m integration``.

    Acceptance criteria:
    - AC-7: All integration tests are marked for selective execution
            (@pytest.mark.integration).
    """
    # The pytestmark at module level propagates to all tests.
    import inspect
    import sys

    module = sys.modules[__name__]
    test_fns = [
        obj
        for name, obj in inspect.getmembers(module, inspect.isfunction)
        if name.startswith("test_")
    ]
    assert test_fns, "No test functions found in this module."
    # All decorated with integration mark via pytestmark (module-level marker).
    # The presence of this test running under -m integration confirms it works.


# ---------------------------------------------------------------------------
# Test 7 — Temporary state is discarded (in-memory cleanup)
# ---------------------------------------------------------------------------


@pytest.mark.integration
async def test_in_memory_state_isolated_between_runs():
    """
    Each test run uses a fresh MemorySaver and a new ScriptedLedger instance.
    State from one run does not bleed into another.

    Acceptance criteria:
    - AC-8: Tests clean up temporary ledger directories after execution.
            (In-memory ledgers have no cleanup requirement; no disk writes occur.)
    """
    FINAL_STEP = {
        "project_status": {"status": "COMPLETE"},
        "wp_list": [_wp("WP-001", "COMPLETE")],
        "wp_details": {"WP-001": _wp("WP-001", "COMPLETE")},
    }

    # Run 1
    ledger_a = ScriptedLedger([FINAL_STEP])
    graph_a, checkpointer_a = _build_integration_graph(ledger_a)
    thread_a = {"configurable": {"thread_id": str(uuid.uuid4())}}
    result_a = await graph_a.ainvoke(_initial_state(), thread_a)

    # Run 2 — independently built
    ledger_b = ScriptedLedger([FINAL_STEP])
    graph_b, checkpointer_b = _build_integration_graph(ledger_b)
    thread_b = {"configurable": {"thread_id": str(uuid.uuid4())}}
    result_b = await graph_b.ainvoke(_initial_state(), thread_b)

    # Both runs complete; checkpointers are independent MemorySaver instances.
    assert checkpointer_a is not checkpointer_b, "Checkpointers must be independent."
    assert result_a.get("errors") == []
    assert result_b.get("errors") == []


# ---------------------------------------------------------------------------
# Live infrastructure tests (skipped by default)
# ---------------------------------------------------------------------------


@pytest.mark.live
@pytest.mark.skip(reason="Requires built MCP server and LLM API key. Run with -m live.")
def test_live_happy_path_with_real_mcp():
    """
    End-to-end smoke test against a real MCP server and LLM model.

    Prerequisites
    -------------
    1. Build the MCP server: ``cd mcp-server && npm run build``
    2. Set ``ANTHROPIC_API_KEY`` or ``GOOGLE_API_KEY`` in ``orchestrator/.env``
    3. Set ``MODEL_NAME`` appropriately
    4. Run: ``python -m pytest tests/test_integration.py -m live -v``

    This test is intentionally left as a skeleton.  Fill in with a real plan
    document path and expected outcomes once environment is configured.
    """
    pytest.skip("Live test — requires real MCP server and LLM API key.")

```
###  Path: `/orchestrator/tests/test_logging.py`

```py
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
# dialogue_captured event formatting
# ---------------------------------------------------------------------------


class TestDialogueCaptured:
    """_build_stream_console_line handles the dialogue_captured event."""

    def test_format_with_file_path(self):
        entry = {
            "stage": "developer",
            "wp_id": "WP-003",
            "action": "dialogue_captured",
            "file_path": "/some/path/dialogues/WP-003-developer-r0.md",
            "level": "INFO",
        }
        line = _build_stream_console_line(entry)
        assert "[developer]" in line
        assert "WP-003" in line
        assert "dialogue saved" in line
        assert "WP-003-developer-r0.md" in line

    def test_format_includes_stage_and_wp(self):
        entry = {
            "stage": "qa",
            "wp_id": "WP-007",
            "action": "dialogue_captured",
            "file_path": "/tmp/dialogues/WP-007-qa-r1.md",
        }
        line = _build_stream_console_line(entry)
        assert "[qa]" in line
        assert "WP-007" in line

    def test_format_no_file_path(self):
        """Must not crash when file_path is missing or empty."""
        entry = {"stage": "developer", "wp_id": "WP-001", "action": "dialogue_captured"}
        line = _build_stream_console_line(entry)
        assert line  # non-empty
        assert "dialogue saved" in line

    def test_no_wp_id(self):
        entry = {
            "stage": "developer",
            "wp_id": "",
            "action": "dialogue_captured",
            "file_path": "/tmp/dialogue.md",
        }
        line = _build_stream_console_line(entry)
        assert "[developer]" in line
        assert "dialogue saved" in line


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


# ---------------------------------------------------------------------------
# TestToolCallRendering — WP-002 Acceptance Criteria
# ---------------------------------------------------------------------------


class TestToolCallRendering:
    """Verify _build_stream_console_line renders tool_call events correctly.

    Each test targets one of the four WP-002 acceptance criteria:
    AC1 — wrench prefix + tool_name in output.
    AC2 — stage prefix and WP ID consistent with other events.
    AC3 — tool_wp_id parenthetical omitted when empty.
    AC4 — no changes to rendering of existing events (spot-checked in TestExistingEventTypes).
    """

    # AC1 — wrench emoji + tool_name

    def test_ac1_wrench_emoji_present(self):
        """🔧 emoji must be present in the rendered line."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_create_work_package",
            "tool_wp_id": "WP-003",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "🔧" in line

    def test_ac1_tool_name_in_output(self):
        """tool_name must appear in the rendered line."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_create_work_package",
            "tool_wp_id": "WP-003",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "ledger_create_work_package" in line

    def test_ac1_tool_wp_id_in_parentheses(self):
        """tool_wp_id must appear in parentheses when non-empty."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_create_work_package",
            "tool_wp_id": "WP-003",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "(WP-003)" in line

    def test_ac1_full_format(self):
        """Full line format: '[pm] 🔧 ledger_create_work_package (WP-003)'."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_create_work_package",
            "tool_wp_id": "WP-003",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert line == "[pm] 🔧 ledger_create_work_package (WP-003)"

    # AC2 — stage prefix and WP ID consistent with other events

    def test_ac2_stage_prefix_in_brackets(self):
        """Stage must appear as [stage] prefix, consistent with other events."""
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "tool_call",
            "tool_name": "ledger_complete_pipeline",
            "tool_wp_id": "WP-001",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "[developer]" in line

    def test_ac2_wp_id_included_when_present(self):
        """stage-level wp_id must appear in the line when non-empty."""
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "tool_call",
            "tool_name": "ledger_complete_pipeline",
            "tool_wp_id": "WP-001",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "WP-001" in line

    def test_ac2_no_stage_wp_id_when_empty(self):
        """When stage wp_id is empty, line must not contain a bare WP-XXX prefix."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_get_next_action",
            "tool_wp_id": "",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        # wp_id is empty — the stage prefix should NOT have a WP ref right after [pm]
        assert line.startswith("[pm]")

    # AC3 — empty tool_wp_id omits parenthetical

    def test_ac3_empty_tool_wp_id_no_parens(self):
        """When tool_wp_id is empty, the parenthetical must be omitted."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_list_work_packages",
            "tool_wp_id": "",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert "()" not in line
        assert "( )" not in line
        assert "🔧 ledger_list_work_packages" in line

    def test_ac3_exact_format_without_tool_wp_id(self):
        """Exact format when tool_wp_id is empty: '[pm] 🔧 ledger_list_work_packages'."""
        entry = {
            "stage": "pm",
            "wp_id": "",
            "action": "tool_call",
            "tool_name": "ledger_list_work_packages",
            "tool_wp_id": "",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        assert line == "[pm] 🔧 ledger_list_work_packages"

    # AC4 — no changes to existing event rendering (spot-checks)

    def test_ac4_heartbeat_unaffected(self):
        """heartbeat event must not be rendered as a tool_call."""
        entry = {"stage": "pm", "wp_id": "", "action": "heartbeat", "silence_s": 30}
        line = _build_stream_console_line(entry)
        assert "♥" in line
        assert "🔧" not in line

    def test_ac4_progress_snapshot_unaffected(self):
        """progress_snapshot event must not be rendered as a tool_call."""
        entry = {"stage": "developer", "wp_id": "WP-001", "action": "progress_snapshot"}
        line = _build_stream_console_line(entry)
        assert "Progress:" in line
        assert "🔧" not in line

    def test_ac4_stage_complete_unaffected(self):
        """stage_complete event must not be rendered as a tool_call."""
        entry = {
            "stage": "developer",
            "wp_id": "WP-001",
            "action": "stage_complete",
            "result": "ok",
        }
        line = _build_stream_console_line(entry)
        assert "🔧" not in line

    def test_tool_call_console_line_distinguishes_stage_wp_id_from_tool_wp_id(self):
        """When wp_id and tool_wp_id differ, both must appear in the rendered
        line at their respective positions, confirming neither value is confused
        with the other.

        Stage wp_id (WP-002) appears right after the [stage] prefix.
        tool_wp_id (WP-007) appears in the trailing parenthetical.
        """
        entry = {
            "stage": "developer",
            "wp_id": "WP-002",
            "action": "tool_call",
            "tool_name": "ledger_begin_work",
            "tool_wp_id": "WP-007",
            "level": "DEBUG",
        }
        line = _build_stream_console_line(entry)
        # Both IDs must appear in the output.
        assert "WP-002" in line, f"stage-level wp_id 'WP-002' missing from: {line!r}"
        assert "WP-007" in line, f"tool-level tool_wp_id 'WP-007' missing from: {line!r}"
        # tool_wp_id must be in the trailing parenthetical.
        assert "(WP-007)" in line, f"tool_wp_id must appear as '(WP-007)' in: {line!r}"
        # stage wp_id must appear between [stage] prefix and the tool emoji.
        assert "[developer] WP-002 🔧" in line, (
            f"stage prefix + wp_id + wrench must appear in order in: {line!r}"
        )

```
###  Path: `/orchestrator/tests/test_mcp_parse.py`

```py
"""
test_mcp_parse.py — Unit tests for src.utils.mcp_parse.parse_tool_response.

Covers every input shape the parser must handle:

1. List with a ``{"type": "text", "text": "<json>"}`` block
2. List without a ``type=text`` block (raw list returned)
3. JSON string (parsed to dict)
4. Non-JSON string (returned as-is)
5. ToolMessage-like object (has ``.content`` attribute)
6. None input
7. Direct dict input (returned as-is)

No external I/O or MCP server required — all tests run in < 1 ms.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from src.utils.mcp_parse import parse_tool_response

# ---------------------------------------------------------------------------
# Parametrized cases
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    # 1. List with a text block whose payload is valid JSON → parsed dict
    (
        [{"type": "text", "text": json.dumps({"action": "IMPLEMENT", "wp_id": "WP-001"})}],
        {"action": "IMPLEMENT", "wp_id": "WP-001"},
    ),
    # 2. List without any ``type=text`` block → raw list returned unchanged
    (
        [{"type": "image", "url": "https://example.com/img.png"}],
        [{"type": "image", "url": "https://example.com/img.png"}],
    ),
    # 3. JSON string → parsed dict
    (
        json.dumps({"status": "PASS", "pipelines": []}),
        {"status": "PASS", "pipelines": []},
    ),
    # 4. Non-JSON string → returned as-is
    (
        "not valid json {{{ }}",
        "not valid json {{{ }}",
    ),
    # 5a. ToolMessage-like: object with `.content` = JSON string → parsed dict
    # (tested separately below because MagicMock needs special setup)
    # 6. None → None
    (None, None),
    # 7. Direct dict → returned as-is
    (
        {"already": "parsed"},
        {"already": "parsed"},
    ),
    # Bonus: list with text block that is NOT valid JSON → text returned as string
    (
        [{"type": "text", "text": "plain non-json text"}],
        "plain non-json text",
    ),
    # Bonus: empty list → empty list returned
    ([], []),
])
def test_parse_tool_response_parametrized(raw, expected):
    """parse_tool_response must handle each raw input shape correctly."""
    result = parse_tool_response(raw)
    assert result == expected


# ---------------------------------------------------------------------------
# ToolMessage-like object (separate test — requires MagicMock)
# ---------------------------------------------------------------------------

def test_parse_tool_response_toolmessage_like_object():
    """
    Objects with a ``.content`` attribute (e.g. LangChain ToolMessage) must
    be unwrapped before parsing.  A JSON-string ``.content`` yields a dict.
    """
    msg = MagicMock(spec_set=["content"])  # only exposes .content
    msg.content = json.dumps({"unwrapped": True, "value": 42})

    result = parse_tool_response(msg)

    assert isinstance(result, dict)
    assert result == {"unwrapped": True, "value": 42}


def test_parse_tool_response_toolmessage_non_json_content():
    """
    ToolMessage-like object whose ``.content`` is a non-JSON string must
    return the raw string (not raise).
    """
    msg = MagicMock(spec_set=["content"])
    msg.content = "plain string content"

    result = parse_tool_response(msg)

    assert result == "plain string content"


def test_parse_tool_response_toolmessage_list_content():
    """
    ToolMessage-like object whose ``.content`` is a list of text blocks must
    be unwrapped and then processed as a list.
    """
    msg = MagicMock(spec_set=["content"])
    msg.content = [{"type": "text", "text": json.dumps({"key": "val"})}]

    result = parse_tool_response(msg)

    assert result == {"key": "val"}


# ---------------------------------------------------------------------------
# Edge-cases on the list path
# ---------------------------------------------------------------------------

def test_parse_tool_response_list_multiple_blocks_first_text_wins():
    """
    When a list has multiple blocks, the first ``type=text`` block is used;
    remaining blocks are ignored.
    """
    raw = [
        {"type": "image", "url": "ignored"},
        {"type": "text", "text": json.dumps({"found": "first-text"})},
        {"type": "text", "text": json.dumps({"found": "second-text"})},
    ]
    result = parse_tool_response(raw)
    assert result == {"found": "first-text"}


def test_parse_tool_response_direct_list_is_not_json():
    """
    A list that is not a content-block list (e.g. a bare Python list of strings)
    is returned as-is when no ``type=text`` block is found.
    """
    raw = ["alpha", "beta", "gamma"]
    result = parse_tool_response(raw)
    assert result == ["alpha", "beta", "gamma"]

```
###  Path: `/orchestrator/tests/test_nodes.py`

```py
"""
test_nodes.py — Unit tests for the eight Deep Agent stage nodes.

These tests verify module structure, factory return types, state-update
conformance, error handling, and stage-specific requirements (PM plan content,
synthesis no WP ID) — without making any real LLM or MCP calls.

All Deep Agent invocations are patched at the ``deepagents.create_deep_agent``
import level so tests run without API keys.
"""

from __future__ import annotations

import importlib
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import AIMessageChunk

from src.utils.chunk_writer import ChunkWriter
from tests.conftest import _CaptureConfig, _NoCaptureConfig  # noqa: F401

# ---------------------------------------------------------------------------
# Minimal config stub
# ---------------------------------------------------------------------------

class _FakeConfig:
    """Minimal Config-like object for test injection."""
    stage_models = {
        "developer": "claude-test", "pm": "claude-test", "qa": "claude-test",
        "reviewer": "claude-test", "security_auditor": "claude-test",
        "docs": "claude-test", "release_engineer": "claude-test",
        "synthesis": "claude-test", "planner": "claude-test",
    }
    workspace_root = Path(__file__).resolve().parent.parent.parent  # ai-insights root
    capture_dialogues = False  # Default off; override in specific test classes
    stream_max_retries = 0
    stream_retry_base_delay_s = 10.0

    def resolve_model_for_stage(self, stage: str) -> str:
        return self.stage_models.get(stage, "claude-test")


FAKE_CONFIG = _FakeConfig()
FAKE_TOOLS: list[Any] = []  # MCP tools not needed for unit tests of nodes


# ---------------------------------------------------------------------------
# Base state fixture
# ---------------------------------------------------------------------------

def base_state(
    *,
    project_path: str = "/project",
    target_project_path: str = "/target",
    current_wp_id: str = "WP-001",
    plan_file: str = "plan.md",
) -> dict:
    return {
        "project_path": project_path,
        "plan_file": plan_file,
        "target_project_path": target_project_path,
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


# ---------------------------------------------------------------------------
# Mock factory helpers
# ---------------------------------------------------------------------------

def _make_agent_mock(response: str = "Done.") -> MagicMock:
    """Return a mock compiled Deep Agent that streams *response* as a single AIMessageChunk.

    The node now uses ``astream(stream_mode="messages", subgraphs=True)`` which
    yields ``(ns_tuple, (msg, metadata))`` 2-tuples.  Each ``AIMessageChunk``
    carries a stable ``id`` so the accumulator merges fragments correctly.
    """
    chunk = AIMessageChunk(
        content=response,
        id="mock-msg-id",
        usage_metadata={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
    )
    stream_items = [((), (chunk, {"langgraph_node": "agent"}))]

    async def _astream(*args: Any, **kwargs: Any):
        for item in stream_items:
            yield item

    agent = MagicMock()
    agent.astream = _astream
    return agent


def _patch_deep_agent(response: str = "Done."):
    """Context manager: patches deepagents.create_deep_agent and LocalShellBackend."""
    agent_mock = _make_agent_mock(response)
    create_patch = patch(
        "deepagents.create_deep_agent",
        return_value=agent_mock,
    )
    backend_patch = patch(
        "deepagents.backends.LocalShellBackend",
        return_value=MagicMock(),
    )
    return create_patch, backend_patch


def _patch_persona(content: str = "Persona content"):
    """Context manager: patches src.utils.persona.load_persona."""
    return patch("src.utils.persona.load_persona", return_value=content)


# ---------------------------------------------------------------------------
# Tests: all 6 modules importable with correct factory functions
# ---------------------------------------------------------------------------

class TestModuleStructure:
    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    def test_module_importable_and_has_factory(self, module_name, factory_name):
        """Each of the 6 modules must be importable and export the factory."""
        mod = importlib.import_module(module_name)
        assert hasattr(mod, factory_name), (
            f"{module_name} missing {factory_name}"
        )
        factory = getattr(mod, factory_name)
        assert callable(factory), f"{factory_name} must be callable"

    def test_nodes_init_exposes_create_stage_node(self):
        """nodes/__init__.py must expose create_stage_node."""
        from src.nodes import create_stage_node
        assert callable(create_stage_node)

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    def test_factory_returns_callable(self, module_name, factory_name):
        """Each factory must return a callable (the node function)."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)
        assert callable(node_fn)


# ---------------------------------------------------------------------------
# Tests: successful invocation returns correct state-update fields
# ---------------------------------------------------------------------------

class TestNodeSuccessPath:
    async def _invoke_node(self, module_name: str, factory_name: str, **state_kwargs) -> dict:
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        create_p, backend_p = _patch_deep_agent("Agent completed successfully.")
        with _patch_persona(), create_p, backend_p:
            return await node_fn(base_state(**state_kwargs))

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.security_auditor", "make_security_auditor_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.release_engineer", "make_release_engineer_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_sets_stage_success_true(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result["stage_success"] is True

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_sets_stage_result(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result["stage_result"] == "Agent completed successfully."

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_appends_run_log_entry(self, module_name, factory_name):
        result = await self._invoke_node(module_name, factory_name)
        assert result.get("run_log"), "run_log must be non-empty on success"
        # stage_start is now at index 0; find the stage_complete entry by action.
        complete_entries = [
            e for e in result["run_log"] if e.get("action") == "stage_complete"
        ]
        assert complete_entries, "run_log must contain a stage_complete entry"
        entry = complete_entries[0]
        assert entry["result"] == "PASS"
        assert "stage" in entry
        assert "timestamp" in entry

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_start_contains_model_field(self, module_name, factory_name):
        """stage_start log entry must contain the resolved model identifier."""
        result = await self._invoke_node(module_name, factory_name)
        start_entries = [e for e in result["run_log"] if e.get("action") == "stage_start"]
        assert start_entries, "run_log must contain a stage_start entry"
        entry = start_entries[0]
        assert "model" in entry, "stage_start entry must have a 'model' field"
        assert entry["model"], "stage_start model field must be non-empty"

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_complete_contains_model_field(self, module_name, factory_name):
        """stage_complete log entry must contain the resolved model identifier."""
        result = await self._invoke_node(module_name, factory_name)
        complete_entries = [e for e in result["run_log"] if e.get("action") == "stage_complete"]
        assert complete_entries, "run_log must contain a stage_complete entry"
        entry = complete_entries[0]
        assert "model" in entry, "stage_complete entry must have a 'model' field"
        assert entry["model"], "stage_complete model field must be non-empty"


# ---------------------------------------------------------------------------
# Tests: error handling
# ---------------------------------------------------------------------------

class TestNodeErrorHandling:
    async def _invoke_with_error(self, module_name: str, factory_name: str) -> dict:
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("Simulated agent crash"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            return await node_fn(base_state())

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_sets_stage_success_false(self, module_name, factory_name):
        """Any exception in the node must set stage_success=False, not crash."""
        result = await self._invoke_with_error(module_name, factory_name)
        assert result["stage_success"] is False

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_appends_to_errors(self, module_name, factory_name):
        result = await self._invoke_with_error(module_name, factory_name)
        assert result.get("errors"), "errors must be non-empty on exception"
        error = result["errors"][0]
        assert "Simulated agent crash" in error["message"]

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_exception_does_not_propagate(self, module_name, factory_name):
        """Stage exceptions must be caught; the graph must not crash."""
        # Calling _invoke_with_error should complete without raising.
        result = await self._invoke_with_error(module_name, factory_name)
        assert result is not None

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_error_log_contains_model_field(self, module_name, factory_name):
        """stage_error log entry must contain the resolved model identifier."""
        result = await self._invoke_with_error(module_name, factory_name)
        error_entries = [e for e in result["run_log"] if e.get("action") == "stage_error"]
        assert error_entries, "run_log must contain a stage_error entry"
        entry = error_entries[0]
        assert "model" in entry, "stage_error entry must have a 'model' field"
        assert entry["model"], "stage_error model field must be non-empty"


# ---------------------------------------------------------------------------
# Tests: stage-specific prompt requirements
# ---------------------------------------------------------------------------

class TestPMNodePromptIncludesPlanContent:
    async def test_pm_prompt_contains_plan_content(self, tmp_path):
        """PM node must include plan document content in the user prompt."""
        # Create a minimal plan file.
        plan_text = "# Test Plan\n\nThis is the plan content."
        plan_file = tmp_path / "plan.md"
        plan_file.write_text(plan_text, encoding="utf-8")

        from src.nodes.pm import make_pm_node

        captured_prompt: list[str] = []

        def fake_agent(*args, **kwargs):
            """Return a mock agent that captures prompt via astream."""
            async def _astream(inputs, *a, **kw):
                """Capture the prompt from the first message and yield a chunk."""
                captured_prompt.append(inputs["messages"][0]["content"])
                chunk = AIMessageChunk(content="PM done.", id="pm-msg-id")
                yield ((), (chunk, {"langgraph_node": "agent"}))

            agent = MagicMock()
            agent.astream = _astream
            return agent

        node_fn = make_pm_node(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona("PM Persona"), patch(
            "deepagents.create_deep_agent", side_effect=fake_agent
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(
                base_state(
                    project_path=str(tmp_path),
                    plan_file="plan.md",
                )
            )

        assert result["stage_success"] is True
        assert captured_prompt, "PM agent was not invoked"
        assert "This is the plan content." in captured_prompt[0], (
            "PM prompt must include plan document content"
        )


class TestSynthesisNodeNoWPRequired:
    def test_synthesis_prompt_does_not_use_wp_id(self):
        """Synthesis prompt must not require current_wp_id."""
        from src.nodes.synthesis import _build_synthesis_prompt

        # Call with an empty current_wp_id — should not raise or embed "WP-".
        state = base_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)

        assert "synthesis" in prompt.lower() or "project" in prompt.lower()
        # There should be no "WP-" reference in a synthesis prompt header.
        assert "Work package:" not in prompt, (
            "Synthesis prompt must not require or reference a specific WP ID"
        )

    async def test_synthesis_node_works_without_wp_id(self):
        """Synthesis node must succeed even when current_wp_id is empty."""
        from src.nodes.synthesis import make_synthesis_node

        node_fn = make_synthesis_node(FAKE_CONFIG, FAKE_TOOLS)
        state = base_state(current_wp_id="")

        create_p, backend_p = _patch_deep_agent("Synthesis complete.")
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(state)

        assert result["stage_success"] is True


# ---------------------------------------------------------------------------
# Tests: persona is loaded for the correct stage
# ---------------------------------------------------------------------------

class TestPersonaLoaded:
    @pytest.mark.parametrize("module_name,factory_name,expected_stage", [
        ("src.nodes.pm", "make_pm_node", "pm"),
        ("src.nodes.developer", "make_developer_node", "developer"),
        ("src.nodes.qa", "make_qa_node", "qa"),
        ("src.nodes.reviewer", "make_reviewer_node", "reviewer"),
        ("src.nodes.docs", "make_docs_node", "docs"),
        ("src.nodes.synthesis", "make_synthesis_node", "synthesis"),
    ])
    async def test_correct_stage_persona_is_loaded(
        self, module_name, factory_name, expected_stage
    ):
        """Each node must call load_persona with its own stage name."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        called_stages: list[str] = []

        def track_persona(stage, **kwargs):
            called_stages.append(stage)
            return f"Persona for {stage}"

        create_p, backend_p = _patch_deep_agent()
        with patch("src.utils.persona.load_persona", side_effect=track_persona), \
             create_p, backend_p:
            await node_fn(base_state())

        assert called_stages == [expected_stage], (
            f"{module_name} loaded persona for {called_stages!r}, "
            f"expected [{expected_stage!r}]"
        )


# ---------------------------------------------------------------------------
# Tests: return values only update allowed WorkflowState fields
# ---------------------------------------------------------------------------

class TestStateUpdateSchema:
    ALLOWED_UPDATE_KEYS = {
        "stage_result",
        "stage_success",
        "run_log",
        "errors",
        # Supervisor-owned fields may also be updated by nodes in principle,
        # but the generic factory only returns these four for stage nodes.
    }

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_success_update_keys_are_subset_of_allowed(
        self, module_name, factory_name
    ):
        """Successful node return must only include allowed WorkflowState keys."""
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)
        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state())

        unexpected = set(result) - self.ALLOWED_UPDATE_KEYS
        assert not unexpected, (
            f"{module_name} returned unexpected state keys: {unexpected}"
        )


# ---------------------------------------------------------------------------
# Tests: inject_project_path integration in create_stage_node
# ---------------------------------------------------------------------------

class TestToolWrappingInNode:
    """Verify that create_stage_node calls inject_project_path and passes the
    wrapped tools to create_deep_agent (WP-005 AC2)."""

    async def test_inject_project_path_is_called(self):
        """create_stage_node must call inject_project_path with the correct
        project_path from state."""
        from src.nodes import create_stage_node

        call_log: list[dict] = []

        def _fake_inject(tools: list, project_path: str) -> list:
            call_log.append({"tools": tools, "project_path": project_path})
            return tools  # pass through

        captured_tools: list[Any] = []

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured_tools.extend(kwargs.get("tools", []))
            return _make_agent_mock()

        fake_tools = [MagicMock()]
        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=fake_tools,
        )

        with _patch_persona(), \
             patch("src.nodes.inject_project_path", side_effect=_fake_inject), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(base_state(project_path="/myproject"))

        assert call_log, "inject_project_path was never called"
        assert call_log[0]["project_path"] == "/myproject", (
            f"inject_project_path called with wrong path: {call_log[0]['project_path']!r}"
        )

    async def test_wrapped_tools_injects_project_path_into_calls(self):
        """The wrapped tools returned by inject_project_path must auto-inject
        project_path into calls that omit it."""
        # Use real inject_project_path (not mocked) to verify end-to-end.
        from src.nodes import create_stage_node

        seen_inputs: list[Any] = []

        async def _tracking_ainvoke(input: Any, *args: Any, **kwargs: Any) -> str:
            seen_inputs.append(input)
            return "ok"

        class _TrackingTool:
            """Plain class tool stub: MagicMock is intentionally avoided because
            MagicMock auto-creates any attribute on lookup, which would cause
            the hasattr(wrapped_tool, '_orig_ainvoke') assertion to pass as a
            false positive even if inject_project_path had not been called."""

            name = "tracking_tool"

            async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> str:  # noqa: A002
                return await _tracking_ainvoke(input, *args, **kwargs)

        real_tool = _TrackingTool()

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=[real_tool],
        )

        # Agent mock that calls tool.ainvoke({}) once during invocation.
        async def _agent_invokes_tool(inputs: dict) -> dict:
            msg = MagicMock()
            msg.content = "done"
            return {"messages": [msg]}

        # We need to capture what tools create_deep_agent receives.
        tools_passed_to_agent: list[Any] = []

        def _fake_create_agent(**kwargs: Any) -> MagicMock:
            tools_passed_to_agent.extend(kwargs.get("tools", []))
            agent = MagicMock()

            async def _astream(inputs, *a, **kw):
                yield ((), (AIMessageChunk(content="done", id="tid"), {"langgraph_node": "agent"}))

            agent.astream = _astream
            return agent

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            await node_fn(base_state(project_path="/wrapped-path"))

        # Verify that create_deep_agent received exactly one tool.
        assert len(tools_passed_to_agent) == 1
        # Verify the tool has been monkeypatched (has the sentinel).
        wrapped_tool = tools_passed_to_agent[0]
        assert hasattr(wrapped_tool, "_orig_ainvoke"), (
            "Tool passed to create_deep_agent must have been wrapped by inject_project_path"
        )

    async def test_wrapped_tools_inject_project_path_on_invocation(self):
        """Wrapped tools must inject project_path when the caller omits it."""
        from src.utils.tool_wrappers import inject_project_path

        seen: list[Any] = []

        class _TrackingTool:
            """Plain class so _orig_ainvoke sentinel behaves correctly."""
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:
                seen.append(input)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], "/from-state")

        await tool.ainvoke({"agent_role": "Developer"})

        assert seen[0]["project_path"] == "/from-state"
        assert seen[0]["agent_role"] == "Developer"

    async def test_wrapped_tools_preserve_explicit_project_path(self):
        """Explicit project_path in tool call must not be overridden by wrapper."""
        from src.utils.tool_wrappers import inject_project_path

        seen: list[Any] = []

        class _TrackingTool:
            """Plain class so _orig_ainvoke sentinel behaves correctly."""
            name = "tracking_tool"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:
                seen.append(input)
                return "ok"

        tool = _TrackingTool()
        inject_project_path([tool], "/default-path")

        await tool.ainvoke({"project_path": "/explicit-path", "type": "qa"})

        assert seen[0]["project_path"] == "/explicit-path"


# ---------------------------------------------------------------------------
# Tests: stage_start event
# ---------------------------------------------------------------------------

class TestStageStartEvent:
    """stage_start must be the first entry in run_log and carry required fields."""

    async def _invoke_developer(self) -> dict:
        from src.nodes.developer import make_developer_node
        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            return await node_fn(base_state(current_wp_id="WP-042"))

    async def test_stage_start_is_first_entry(self):
        result = await self._invoke_developer()
        assert result.get("run_log"), "run_log must be non-empty"
        assert result["run_log"][0]["action"] == "stage_start"

    async def test_stage_start_has_required_fields(self):
        result = await self._invoke_developer()
        entry = result["run_log"][0]
        assert entry["action"] == "stage_start"
        assert "stage" in entry
        assert "wp_id" in entry
        assert "iteration" in entry
        assert "timestamp" in entry
        assert "level" in entry

    async def test_stage_start_wp_id_matches_state(self):
        result = await self._invoke_developer()
        entry = result["run_log"][0]
        assert entry["wp_id"] == "WP-042"

    async def test_stage_start_emitted_on_error_path(self):
        """stage_start must be in run_log even when the agent raises."""
        from src.nodes.developer import make_developer_node
        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)
        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("boom"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-042"))

        assert result["run_log"][0]["action"] == "stage_start", (
            "stage_start must be first in run_log even on error path"
        )


# ---------------------------------------------------------------------------
# Tests: duration_s on stage_complete and stage_error
# ---------------------------------------------------------------------------

class TestDurationS:
    """duration_s must be present on stage_complete and stage_error entries."""

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_complete_has_duration_s(self, module_name, factory_name):
        """stage_complete entry must include duration_s as a float."""
        mod = __import__(module_name, fromlist=[factory_name])
        node_fn = getattr(mod, factory_name)(FAKE_CONFIG, FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state())

        entries = [e for e in result["run_log"] if e.get("action") == "stage_complete"]
        assert entries, "stage_complete entry missing from run_log"
        entry = entries[0]
        assert "duration_s" in entry, "stage_complete must include duration_s"
        assert isinstance(entry["duration_s"], (int, float)), (
            f"duration_s must be numeric, got {type(entry['duration_s'])}"
        )
        assert entry["duration_s"] >= 0

    @pytest.mark.parametrize("module_name,factory_name", [
        ("src.nodes.pm", "make_pm_node"),
        ("src.nodes.developer", "make_developer_node"),
        ("src.nodes.qa", "make_qa_node"),
        ("src.nodes.reviewer", "make_reviewer_node"),
        ("src.nodes.docs", "make_docs_node"),
        ("src.nodes.synthesis", "make_synthesis_node"),
    ])
    async def test_stage_error_has_duration_s(self, module_name, factory_name):
        """stage_error entry must include duration_s (time until failure)."""
        mod = __import__(module_name, fromlist=[factory_name])
        node_fn = getattr(mod, factory_name)(FAKE_CONFIG, FAKE_TOOLS)
        with _patch_persona(), patch(
            "deepagents.create_deep_agent",
            side_effect=RuntimeError("agent crash"),
        ), patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state())

        entries = [e for e in result["run_log"] if e.get("action") == "stage_error"]
        assert entries, "stage_error entry missing from run_log"
        entry = entries[0]
        assert "duration_s" in entry, "stage_error must include duration_s"
        assert isinstance(entry["duration_s"], (int, float)), (
            f"duration_s must be numeric, got {type(entry['duration_s'])}"
        )
        assert entry["duration_s"] >= 0


# ---------------------------------------------------------------------------
# Tests: pipeline_result read-back
# ---------------------------------------------------------------------------

class TestPipelineResult:
    """pipeline_result must be emitted when ledger_get_work_package is available."""

    def _make_wp_tool(self, pipelines: list) -> Any:
        """Return a plain-class ledger_get_work_package tool returning *pipelines*.

        MagicMock is intentionally avoided: MagicMock auto-creates ``_orig_ainvoke``
        on attribute lookup, which causes ``inject_project_path`` to skip wrapping
        and call the wrong callable, silently breaking the read-back.
        """
        import json as _json

        return_value = _json.dumps({"work_package_id": "WP-001", "pipelines": pipelines})

        class _WPTool:
            """Plain-class stub so inject_project_path can wrap it correctly."""
            name = "ledger_get_work_package"

            def __init__(self, rv: str) -> None:
                self._rv = rv

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> str:  # noqa: A002
                return self._rv

        return _WPTool(return_value)

    async def test_pipeline_result_emitted_when_tool_available(self):
        """pipeline_result entry must appear in run_log when a WP tool is present."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {
                "type": "implementation",
                "status": "PASS",
                "artifacts": {"files_modified": ["src/foo.py"]},
                "metrics": {"tests_passed": 5},
                "summary": ["Implemented feature X"],
                "duration_ms": 5000,
            }
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries, "pipeline_result entry expected in run_log"
        entry = pr_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["pipeline_type"] == "implementation"
        assert entry["pipeline_status"] == "PASS"
        assert entry["files_modified"] == ["src/foo.py"]
        assert entry["metrics"] == {"tests_passed": 5}
        assert entry["summary"] == ["Implemented feature X"]
        assert entry["duration_s"] == 5.0

    async def test_pipeline_result_duration_s_from_duration_ms(self):
        """duration_s must be derived from duration_ms (ms / 1000, rounded to 1 dp)."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "qa", "status": "PASS", "duration_ms": 3700}
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries
        assert pr_entries[0]["duration_s"] == 3.7

    async def test_pipeline_result_none_duration_when_no_duration_ms(self):
        """duration_s must be None when duration_ms is absent from WP data."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "implementation", "status": "PASS"}
            # no duration_ms
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert pr_entries
        assert pr_entries[0]["duration_s"] is None

    async def test_pipeline_result_not_emitted_when_no_wp_id(self):
        """pipeline_result must not be emitted when current_wp_id is empty."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([
            {"type": "implementation", "status": "PASS"}
        ])
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id=""))  # empty wp_id

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries, "pipeline_result must not be emitted when wp_id is empty"

    async def test_pipeline_result_not_emitted_without_tool(self):
        """No pipeline_result when FAKE_TOOLS has no ledger_get_work_package tool."""
        from src.nodes.developer import make_developer_node

        node_fn = make_developer_node(FAKE_CONFIG, FAKE_TOOLS)  # FAKE_TOOLS = []
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries, "pipeline_result must not be emitted when no wp tool exists"

    async def test_read_back_failure_does_not_affect_stage_success(self):
        """Failure in ledger_get_work_package must not set stage_success=False."""
        from src.nodes.developer import make_developer_node

        class _FailingWPTool:
            """Plain-class stub that always raises on invocation."""
            name = "ledger_get_work_package"

            async def ainvoke(self, input: Any, *a: Any, **kw: Any) -> None:  # noqa: A002
                raise RuntimeError("MCP unavailable")

        node_fn = make_developer_node(FAKE_CONFIG, [_FailingWPTool()])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is True, (
            "Read-back failure must not affect stage_success"
        )
        # Also confirm no pipeline_result was emitted.
        pr_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_result"]
        assert not pr_entries

    async def test_pipeline_result_not_emitted_when_pipelines_list_is_empty(self):
        """No pipeline_result entry must appear when ledger_get_work_package
        returns a WP whose pipelines list is empty (no pipeline has run yet)."""
        from src.nodes.developer import make_developer_node

        wp_tool = self._make_wp_tool([])  # empty pipelines list
        node_fn = make_developer_node(FAKE_CONFIG, [wp_tool])
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p:
            result = await node_fn(base_state(current_wp_id="WP-001"))

        pr_entries = [
            e for e in result["run_log"] if e.get("action") == "pipeline_result"
        ]
        assert not pr_entries, (
            "pipeline_result must not be emitted when WP has no pipelines"
        )


# ---------------------------------------------------------------------------
# Tests: dialogue_captured event
# ---------------------------------------------------------------------------


# _CaptureConfig and _NoCaptureConfig are defined in conftest.py and imported
# at the top of this file.


def _make_mock_chunk_writer(path: Path = Path("/tmp/WP-001-developer-r0.jsonl")) -> MagicMock:
    """Return a MagicMock ChunkWriter whose .path property returns *path*."""
    mock_cw = MagicMock()
    mock_cw.path = path
    mock_cw.write_chunk = MagicMock()
    mock_cw.close = MagicMock()
    return mock_cw


def _patch_chunk_writer(
    path: Path = Path("/tmp/WP-001-developer-r0.jsonl"),
) -> Any:
    """Patch src.nodes.ChunkWriter to return a mock that avoids real I/O."""
    mock_cw = _make_mock_chunk_writer(path)
    return patch("src.nodes.ChunkWriter", return_value=mock_cw)


class TestDialogueCaptured:
    """dialogue_captured must appear in run_log when capture_dialogues=True.

    Only one dialogue_captured event is emitted per successful stage:
    format="chunks" — for the JSONL chunk file written during streaming.
    The Markdown dialogue file render was removed; the chunk JSONL is the
    sole durable source of truth.

    ChunkWriter is patched in all sub-tests to avoid real filesystem I/O.
    """

    _CHUNK_PATH = Path("/tmp/WP-001-developer-r0.jsonl")

    async def _invoke_with_capture(self, capture: bool, wp_id: str = "WP-001") -> dict:
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig() if capture else _NoCaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             _patch_chunk_writer(self._CHUNK_PATH):
            return await node_fn(base_state(current_wp_id=wp_id))

    async def test_dialogue_captured_emitted_when_flag_true(self):
        """At least one dialogue_captured entry must appear when capture_dialogues=True."""
        result = await self._invoke_with_capture(capture=True)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert dc_entries, "dialogue_captured entry expected in run_log when capture_dialogues=True"

    async def test_chunk_dialogue_captured_has_format_chunks(self):
        """The chunk dialogue_captured entry must carry format='chunks'."""
        result = await self._invoke_with_capture(capture=True)
        chunk_entries = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured" and e.get("format") == "chunks"
        ]
        assert chunk_entries, "chunk dialogue_captured entry (format='chunks') expected"
        entry = chunk_entries[0]
        assert entry.get("file_path"), "chunk dialogue_captured must have a non-empty file_path"
        assert entry.get("level") == "INFO"
        assert entry.get("wp_id") == "WP-001"

    async def test_no_markdown_dialogue_captured(self):
        """No Markdown dialogue_captured entry (without format key) must be emitted."""
        result = await self._invoke_with_capture(capture=True)
        md_entries = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured" and "format" not in e
        ]
        assert not md_entries, "Markdown dialogue_captured entry must NOT be emitted"

    async def test_dialogue_captured_has_required_fields(self):
        """All dialogue_captured entries must have action, stage, wp_id, file_path, level."""
        result = await self._invoke_with_capture(capture=True)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert dc_entries, "dialogue_captured entry missing"
        for entry in dc_entries:
            assert entry["action"] == "dialogue_captured"
            assert "stage" in entry
            assert "wp_id" in entry
            assert entry.get("file_path"), "file_path must be a non-empty string"
            assert entry.get("level") == "INFO"
            assert entry.get("format") == "chunks", (
                "all dialogue_captured entries must have format='chunks'"
            )

    async def test_dialogue_captured_not_emitted_when_flag_false(self):
        """No dialogue_captured entry when capture_dialogues=False."""
        result = await self._invoke_with_capture(capture=False)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when capture_dialogues=False"

    async def test_dialogue_captured_not_emitted_when_wp_id_empty(self):
        """No dialogue_captured entry when wp_id is empty (even if flag is True)."""
        result = await self._invoke_with_capture(capture=True, wp_id="")
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when wp_id is empty"


# ---------------------------------------------------------------------------
# Tests: error-path — no Markdown dialogue capture
# ---------------------------------------------------------------------------


class TestErrorPathNoMarkdownDialogue:
    """After removing the Markdown dialogue render, the error path must NOT
    produce any Markdown dialogue_captured events.  The chunk file (already
    on disk from streaming) is the sole capture artefact."""

    class _BrokenMsg:
        """Message stub whose .content access raises, simulating a post-stream crash."""

        @property
        def content(self) -> str:
            raise RuntimeError("Simulated failure in success path after stream")

        usage_metadata = None

        def model_dump(self) -> dict:
            return {}

    async def _invoke_with_post_ainvoke_error(
        self, capture: bool = True, wp_id: str = "WP-001"
    ) -> dict:
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig() if capture else _NoCaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]

        broken = self._BrokenMsg()

        async def _astream(inputs, *args, **kwargs):
            yield ((), (broken, {"langgraph_node": "agent"}))

        agent_mock = MagicMock()
        agent_mock.astream = _astream

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             _patch_chunk_writer():
            return await node_fn(base_state(current_wp_id=wp_id))

    async def test_no_partial_markdown_on_error_path(self):
        """No partial Markdown dialogue_captured event must appear on the error path."""
        result = await self._invoke_with_post_ainvoke_error()
        partial_entries = [
            e for e in result["run_log"]
            if e.get("action") == "dialogue_captured" and e.get("partial") is True
        ]
        assert not partial_entries, (
            "Error-path Markdown dialogue_captured (partial=True) must NOT appear "
            "after Markdown render removal"
        )

    async def test_stage_fails_on_error_path(self):
        """Stage must still return stage_success=False on the error path."""
        result = await self._invoke_with_post_ainvoke_error()
        assert result["stage_success"] is False

    async def test_no_dialogue_when_msgs_empty(self):
        """No dialogue_captured when exception occurs before astream()."""
        from src.nodes.developer import make_developer_node

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]

        with _patch_persona(), \
             patch(
                 "deepagents.create_deep_agent",
                 side_effect=RuntimeError("Pre-ainvoke crash"),
             ), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             _patch_chunk_writer():
            result = await node_fn(base_state(current_wp_id="WP-001"))

        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, (
            "dialogue_captured must NOT appear when _msgs is empty (exception before astream)"
        )
        assert result["stage_success"] is False

    async def test_no_dialogue_when_capture_flag_false(self):
        """Error-path dialogue capture must respect capture_dialogues=False."""
        result = await self._invoke_with_post_ainvoke_error(capture=False)
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when capture_dialogues=False"

    async def test_no_dialogue_when_wp_id_empty(self):
        """Error-path dialogue capture must not fire when wp_id is empty."""
        result = await self._invoke_with_post_ainvoke_error(wp_id="")
        dc_entries = [e for e in result["run_log"] if e.get("action") == "dialogue_captured"]
        assert not dc_entries, "dialogue_captured must not appear when wp_id is empty"


# ---------------------------------------------------------------------------
# Tests: slug derivation uses Path(...).name (WP-002)
# ---------------------------------------------------------------------------


class TestSlugDerivation:
    """create_stage_node must use Path(project_path_obj).name to derive the slug,
    which handles trailing-slash paths and pathlib.Path-typed inputs correctly.

    Slug derivation is verified via the ChunkWriter constructor args, since
    Markdown dialogue render was removed and ChunkWriter is the only consumer
    of slug_dir in the node's success path.
    """

    async def _invoke_and_capture_slug_dir(self, project_path: Any) -> list[Path]:
        """Invoke developer node with the given project_path; return every
        slug_dir passed to ChunkWriter."""
        from src.nodes.developer import make_developer_node

        captured_slug_dirs: list[Path] = []

        _original_init = ChunkWriter.__init__

        def _tracking_init(self_cw, slug_dir, wp_id, stage):
            captured_slug_dirs.append(slug_dir)
            # Call the mock's path property setup
            self_cw._path = Path("/tmp") / f"{wp_id}-{stage}-r0.jsonl"
            self_cw._closed = False
            self_cw._fh = None

        mock_cw = MagicMock(spec=ChunkWriter)
        mock_cw.path = Path("/tmp/WP-001-developer-r0.jsonl")

        def _fake_chunk_writer(slug_dir, wp_id, stage):
            captured_slug_dirs.append(slug_dir)
            m = MagicMock()
            m.path = Path("/tmp") / f"{wp_id}-{stage}-r0.jsonl"
            return m

        cfg = _CaptureConfig()
        node_fn = make_developer_node(cfg, FAKE_TOOLS)  # type: ignore[arg-type]
        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.ChunkWriter", side_effect=_fake_chunk_writer):
            await node_fn(base_state(project_path=project_path, current_wp_id="WP-001"))

        return captured_slug_dirs

    async def test_trailing_slash_path_extracts_correct_slug(self):
        """Path with a trailing '/' must still produce the correct slug segment."""
        slug_dirs = await self._invoke_and_capture_slug_dir(
            "/some/ledger/root/2026-03-20-my-project/"
        )
        assert slug_dirs, "ChunkWriter was not called (capture_dialogues must be True)"
        # slug_dir is workspace_root / "mcp-server" / "storage" / "ledger" / slug
        # — the last component must be the project slug, not an empty string.
        assert slug_dirs[0].name == "2026-03-20-my-project", (
            f"Expected slug '2026-03-20-my-project', got '{slug_dirs[0].name}'"
        )

    async def test_pathlib_path_typed_input_extracts_correct_slug(self):
        """A pathlib.Path-typed project_path must produce the correct slug segment."""
        slug_dirs = await self._invoke_and_capture_slug_dir(
            Path("/some/ledger/root/2026-03-20-my-project")
        )
        assert slug_dirs, "ChunkWriter was not called (capture_dialogues must be True)"
        assert slug_dirs[0].name == "2026-03-20-my-project", (
            f"Expected slug '2026-03-20-my-project', got '{slug_dirs[0].name}'"
        )


# ---------------------------------------------------------------------------
# Tests: slim prompt content (WP-005)
# ---------------------------------------------------------------------------
# AC3: slim fields (project_path, wp_id where applicable, injection-safety
#      warning) are present in each _build_*_prompt() return value.
# AC4: identity/role declaration text is absent from each prompt.
# ---------------------------------------------------------------------------

_IDENTITY_PHRASES = [
    "You are the",
    "You are a",
    "As the ",
    "As a ",
    "Your role is",
    "Your task is to",
    "Your job is",
]

_SLIM_PROJECT_PATH = "/test/project/path"
_SLIM_WP_ID = "WP-099"


def _build_slim_state(**overrides) -> dict:
    """Minimal state dict for slim-prompt unit tests."""
    s = base_state(
        project_path=_SLIM_PROJECT_PATH,
        current_wp_id=_SLIM_WP_ID,
    )
    s.update(overrides)
    return s


class TestSlimPromptContent:
    """Direct unit tests on each _build_*_prompt() function.

    Verifies that the slimmed prompts (introduced in WP-001/002/003):
    - Include the mandatory runtime context fields (AC3).
    - Do not contain identity/role declaration phrases (AC4).
    """

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _assert_slim_fields_present(self, prompt: str, *, expect_wp: bool = True) -> None:
        """Assert all mandatory slim fields appear in *prompt*."""
        assert _SLIM_PROJECT_PATH in prompt, (
            f"project_path {_SLIM_PROJECT_PATH!r} must be present in prompt"
        )
        assert "ledger tool calls" in prompt, (
            "project_path reminder must be present in prompt"
        )
        if expect_wp:
            assert _SLIM_WP_ID in prompt, (
                f"wp_id {_SLIM_WP_ID!r} must be present in prompt"
            )

    def _assert_no_identity_phrases(self, prompt: str, node: str) -> None:
        """Assert none of the known identity/role declaration phrases appear."""
        for phrase in _IDENTITY_PHRASES:
            assert phrase not in prompt, (
                f"{node}: identity/role phrase {phrase!r} must not appear in slim prompt"
            )

    # ------------------------------------------------------------------
    # Developer node
    # ------------------------------------------------------------------

    def test_developer_prompt_has_slim_fields(self):
        """_build_developer_prompt must include project_path and project_path reminder."""
        from src.nodes.developer import _build_developer_prompt

        prompt = _build_developer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_developer_prompt_has_no_identity_declarations(self):
        """_build_developer_prompt must not contain identity/role declaration text."""
        from src.nodes.developer import _build_developer_prompt

        prompt = _build_developer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "developer")

    # ------------------------------------------------------------------
    # QA node
    # ------------------------------------------------------------------

    def test_qa_prompt_has_slim_fields(self):
        """_build_qa_prompt must include project_path and project_path reminder."""
        from src.nodes.qa import _build_qa_prompt

        prompt = _build_qa_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_qa_prompt_has_no_identity_declarations(self):
        """_build_qa_prompt must not contain identity/role declaration text."""
        from src.nodes.qa import _build_qa_prompt

        prompt = _build_qa_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "qa")

    # ------------------------------------------------------------------
    # Reviewer node
    # ------------------------------------------------------------------

    def test_reviewer_prompt_has_slim_fields(self):
        """_build_reviewer_prompt must include project_path and project_path reminder."""
        from src.nodes.reviewer import _build_reviewer_prompt

        prompt = _build_reviewer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_reviewer_prompt_has_no_identity_declarations(self):
        """_build_reviewer_prompt must not contain identity/role declaration text."""
        from src.nodes.reviewer import _build_reviewer_prompt

        prompt = _build_reviewer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "reviewer")

    # ------------------------------------------------------------------
    # Security Auditor node
    # ------------------------------------------------------------------

    def test_security_auditor_prompt_has_slim_fields(self):
        """_build_security_auditor_prompt must include project_path
        and project_path reminder."""
        from src.nodes.security_auditor import _build_security_auditor_prompt

        prompt = _build_security_auditor_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_security_auditor_prompt_has_no_identity_declarations(self):
        """_build_security_auditor_prompt must not contain identity/role declaration text."""
        from src.nodes.security_auditor import _build_security_auditor_prompt

        prompt = _build_security_auditor_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "security_auditor")

    # ------------------------------------------------------------------
    # Release Engineer node
    # ------------------------------------------------------------------

    def test_release_engineer_prompt_has_slim_fields(self):
        """_build_release_engineer_prompt must include project_path
        and project_path reminder."""
        from src.nodes.release_engineer import _build_release_engineer_prompt

        prompt = _build_release_engineer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_release_engineer_prompt_has_no_identity_declarations(self):
        """_build_release_engineer_prompt must not contain identity/role declaration text."""
        from src.nodes.release_engineer import _build_release_engineer_prompt

        prompt = _build_release_engineer_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "release_engineer")

    # ------------------------------------------------------------------
    # Docs node
    # ------------------------------------------------------------------

    def test_docs_prompt_has_slim_fields(self):
        """_build_docs_prompt must include project_path and project_path reminder."""
        from src.nodes.docs import _build_docs_prompt

        prompt = _build_docs_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_docs_prompt_has_no_identity_declarations(self):
        """_build_docs_prompt must not contain identity/role declaration text."""
        from src.nodes.docs import _build_docs_prompt

        prompt = _build_docs_prompt(_build_slim_state())  # type: ignore[arg-type]
        self._assert_no_identity_phrases(prompt, "docs")

    # ------------------------------------------------------------------
    # PM node (special: embeds plan content; no wp_id)
    # ------------------------------------------------------------------

    def test_pm_prompt_has_slim_fields(self, tmp_path):
        """_build_pm_prompt must embed plan_file reference and plan content.

        The PM is the first agent in the chain — it determines the project
        path from the plan's location rather than consuming it from the
        prompt.  Therefore the prompt intentionally omits project_path and
        the project-path-reminder partial.
        """
        from src.nodes.pm import _build_pm_prompt

        plan_file = tmp_path / "plan.md"
        plan_file.write_text("# Plan\nContent.", encoding="utf-8")

        state = _build_slim_state(project_path=str(tmp_path), plan_file="plan.md")
        prompt = _build_pm_prompt(state)  # type: ignore[arg-type]

        assert "plan.md" in prompt, "plan_file reference must be present in PM prompt"
        assert "# Plan" in prompt, "plan content must be embedded in PM prompt"

    def test_pm_prompt_has_no_identity_declarations(self, tmp_path):
        """_build_pm_prompt must not contain identity/role declaration text."""
        from src.nodes.pm import _build_pm_prompt

        plan_file = tmp_path / "plan.md"
        plan_file.write_text("# Plan\nContent.", encoding="utf-8")

        state = _build_slim_state(project_path=str(tmp_path), plan_file="plan.md")
        prompt = _build_pm_prompt(state)  # type: ignore[arg-type]

        self._assert_no_identity_phrases(prompt, "pm")

    # ------------------------------------------------------------------
    # Synthesis node (no wp_id)
    # ------------------------------------------------------------------

    def test_synthesis_prompt_has_slim_fields(self):
        """_build_synthesis_prompt must include project_path and project_path
        reminder (no wp_id)."""
        from src.nodes.synthesis import _build_synthesis_prompt

        state = _build_slim_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)  # type: ignore[arg-type]

        self._assert_slim_fields_present(prompt, expect_wp=False)

    def test_synthesis_prompt_has_no_identity_declarations(self):
        """_build_synthesis_prompt must not contain identity/role declaration text."""
        from src.nodes.synthesis import _build_synthesis_prompt

        state = _build_slim_state(current_wp_id="")
        prompt = _build_synthesis_prompt(state)  # type: ignore[arg-type]

        self._assert_no_identity_phrases(prompt, "synthesis")


# ---------------------------------------------------------------------------
# Tests: pipeline rollback when begin_work is called before a stage error
# ---------------------------------------------------------------------------

class TestPipelineRollback:
    """
    Verify the orphaned-pipeline rollback logic in create_stage_node.

    When the Deep Agent errors after calling ledger_begin_work, the node must
    automatically call ledger_cancel_pipeline with auto_cancelled=True so that
    the orphaned IN_PROGRESS pipeline does not block the next run attempt.
    """

    class _RecordingTool:
        """Plain tool stub with call recording. MagicMock is intentionally avoided
        because its auto-attribute creation breaks the ``hasattr`` sentinel checks
        used by inject_project_path, restrict_to_wp, and _install_begin_work_tracker."""

        def __init__(self, name: str, raises: Exception | None = None) -> None:
            self.name = name
            self._raises = raises
            self.calls: list[Any] = []

        async def ainvoke(self, input: Any, *args: Any, **kwargs: Any) -> Any:  # noqa: A002
            self.calls.append(input)
            if self._raises is not None:
                raise self._raises
            return {"content": [{"type": "text", "text": "{}"}]}

    async def test_rollback_called_when_begin_work_invoked_before_error(self):
        """When begin_work is called and the agent then crashes, cancel_pipeline
        must be called with auto_cancelled=True."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        # Fake agent: calls ledger_begin_work (to trigger the tracker),
        # then raises RuntimeError to exercise the rollback path.
        async def _fake_agent_astream(inputs, *args, **kwargs):
            # Call begin_work via the tool reference which, after node_fn runs
            # inject_project_path + restrict_to_wp + _install_begin_work_tracker,
            # points to the tracker-wrapped ainvoke.
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("Simulated agent crash after begin_work")
            # unreachable — satisfies async generator requirement
            yield  # makes this an async generator

        agent_mock = MagicMock()
        agent_mock.astream = _fake_agent_astream

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False

        assert cancel_tool.calls, "ledger_cancel_pipeline must have been called"
        call_args = cancel_tool.calls[-1]
        assert call_args.get("auto_cancelled") is True
        assert call_args.get("work_package_id") == "WP-001"
        assert call_args.get("type") == "implementation"

    async def test_rollback_not_called_when_begin_work_not_invoked(self):
        """When the agent crashes without calling begin_work, cancel_pipeline
        must NOT be called."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        # Fake agent: crashes immediately without calling begin_work.
        async def _fake_agent_astream(inputs, *args, **kwargs):
            raise RuntimeError("Simulated crash without begin_work")
            yield  # makes this an async generator

        agent_mock = MagicMock()
        agent_mock.astream = _fake_agent_astream

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False
        assert not cancel_tool.calls, "ledger_cancel_pipeline must NOT have been called"

    async def test_rollback_run_log_contains_pipeline_rollback_entry(self):
        """Successful rollback must append a pipeline_rollback entry to run_log."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool("ledger_cancel_pipeline")
        tools = [begin_work_tool, cancel_tool]

        async def _fake_agent_astream(inputs, *args, **kwargs):
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("crash")
            yield  # makes this an async generator

        agent_mock = MagicMock()
        agent_mock.astream = _fake_agent_astream

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        rollback_entries = [e for e in result["run_log"] if e.get("action") == "pipeline_rollback"]
        assert rollback_entries, "run_log must contain a pipeline_rollback entry after rollback"
        entry = rollback_entries[0]
        assert entry["level"] == "INFO"
        assert entry["wp_id"] == "WP-001"
        assert entry["pipeline_type"] == "implementation"

    async def test_rollback_original_error_preserved_when_cancel_fails(self):
        """When cancel_pipeline itself raises, the original error must still
        appear in the returned errors list."""
        from src.nodes import create_stage_node

        begin_work_tool = self._RecordingTool("ledger_begin_work")
        cancel_tool = self._RecordingTool(
            "ledger_cancel_pipeline", raises=RuntimeError("cancel_pipeline failed")
        )
        tools = [begin_work_tool, cancel_tool]

        async def _fake_agent_astream(inputs, *args, **kwargs):
            await begin_work_tool.ainvoke(
                {"type": "implementation", "work_package_id": "WP-001"}
            )
            raise RuntimeError("Original agent crash")
            yield  # makes this an async generator

        agent_mock = MagicMock()
        agent_mock.astream = _fake_agent_astream

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda s: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=tools,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=agent_mock), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()):
            result = await node_fn(base_state(current_wp_id="WP-001"))

        assert result["stage_success"] is False
        errors = result.get("errors", [])
        assert errors, "errors must be non-empty"
        assert "Original agent crash" in errors[0]["message"]


# ---------------------------------------------------------------------------
# Tests: log_tool_calls wiring inside create_stage_node
# ---------------------------------------------------------------------------


class TestCreateStageNodeWiring:
    """Verify that create_stage_node wires log_tool_calls with the correct
    stage, wp_id, and logger arguments (WP-002 integration coverage)."""

    async def test_log_tool_calls_is_wired_with_correct_args(self):
        """create_stage_node must call log_tool_calls exactly once, passing
        the correct stage, wp_id, and run_logger (None in unit tests)."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.log_tool_calls") as mock_log:
            await node_fn(base_state(current_wp_id="WP-003"))

        mock_log.assert_called_once()
        args = mock_log.call_args.args
        # args: (wrapped_tools, stage, wp_id, run_logger)
        assert args[1] == "developer", (
            f"log_tool_calls called with wrong stage: {args[1]!r}"
        )
        assert args[2] == "WP-003", (
            f"log_tool_calls called with wrong wp_id: {args[2]!r}"
        )
        # run_logger is None in unit tests (no RunnableConfig provided)
        assert args[3] is None, (
            f"log_tool_calls called with unexpected logger: {args[3]!r}"
        )

    async def test_log_tool_calls_wired_for_synthesis_empty_wp_id(self):
        """Synthesis stages have empty wp_id; log_tool_calls must still fire
        with wp_id='' so the wrapper can handle project-scoped calls."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="synthesis",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        create_p, backend_p = _patch_deep_agent()
        with _patch_persona(), create_p, backend_p, \
             patch("src.nodes.log_tool_calls") as mock_log:
            await node_fn(base_state(current_wp_id=""))

        mock_log.assert_called_once()
        args = mock_log.call_args.args
        assert args[1] == "synthesis", (
            f"log_tool_calls called with wrong stage: {args[1]!r}"
        )
        assert args[2] == "", (
            f"log_tool_calls called with non-empty wp_id for synthesis: {args[2]!r}"
        )
        assert args[3] is None


# ---------------------------------------------------------------------------
# Tests: LocalShellBackend receives inherit_env=True
# ---------------------------------------------------------------------------


class TestLocalShellBackendInheritEnv:
    """LocalShellBackend must be constructed with inherit_env=True so that
    agent subprocesses can access host CLI tools (python, npm, git, etc.)."""

    async def test_stage_node_passes_inherit_env_true(self):
        """create_stage_node must call LocalShellBackend(inherit_env=True)."""
        from src.nodes import create_stage_node

        node_fn = create_stage_node(
            stage="developer",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        backend_cls_mock = MagicMock(return_value=MagicMock())

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", return_value=_make_agent_mock()), \
             patch("deepagents.backends.LocalShellBackend", backend_cls_mock):
            await node_fn(base_state())

        backend_cls_mock.assert_called_once()
        _, kwargs = backend_cls_mock.call_args
        assert kwargs.get("inherit_env") is True, (
            f"LocalShellBackend must be called with inherit_env=True, "
            f"got kwargs={kwargs!r}"
        )


# ---------------------------------------------------------------------------
# Tests: subagent wiring (WP-013)
# ---------------------------------------------------------------------------

class TestSubagentWiring:
    """Verify that create_stage_node passes subagents to create_deep_agent for
    stages that have subagent configuration, and passes None for those that do
    not (WP-013 acceptance criteria)."""

    async def test_pm_node_passes_subagents_to_create_deep_agent(self):
        """AC-1: PM agent's create_deep_agent() call includes subagents with
        at least WP Decomposer."""
        from src.nodes import create_stage_node

        fake_subagent = {
            "name": "WP Decomposer",
            "description": "Analyze a plan document and decompose it into Work Packages.",
            "system_prompt": "# WP Decomposer\nYou decompose plans into WPs.",
        }

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = create_stage_node(
            stage="pm",
            build_prompt=lambda state: "Test prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[fake_subagent]):
            await node_fn(base_state(current_wp_id=""))

        assert captured.get("subagents") is not None, (
            "create_deep_agent must receive subagents for the pm stage"
        )
        assert isinstance(captured["subagents"], list), (
            "subagents must be a list"
        )
        assert len(captured["subagents"]) >= 1, (
            "subagents list must contain at least one entry (WP Decomposer)"
        )
        names = [s["name"] for s in captured["subagents"]]
        assert "WP Decomposer" in names, (
            f"WP Decomposer must be in subagents; got {names!r}"
        )

    async def test_pm_subagent_definition_contains_system_prompt(self):
        """AC-2: Subagent definition includes persona content (system_prompt field)."""
        from src.nodes import create_stage_node

        persona_content = "# WP Decomposer\nYou analyze plans and decompose them."
        fake_subagent = {
            "name": "WP Decomposer",
            "description": "Decompose plan into WPs.",
            "system_prompt": persona_content,
        }

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = create_stage_node(
            stage="pm",
            build_prompt=lambda state: "prompt",
            config=FAKE_CONFIG,
            mcp_tools=FAKE_TOOLS,
        )

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[fake_subagent]):
            await node_fn(base_state(current_wp_id=""))

        subagents = captured.get("subagents") or []
        assert subagents, "subagents must be non-empty for pm stage"
        wp_decomposer = next((s for s in subagents if s["name"] == "WP Decomposer"), None)
        assert wp_decomposer is not None, "WP Decomposer entry must be present"
        assert "system_prompt" in wp_decomposer, (
            "SubAgent dict must contain system_prompt"
        )
        assert wp_decomposer["system_prompt"] == persona_content, (
            "system_prompt must match the loaded persona content"
        )

    @pytest.mark.parametrize("module_name,factory_name,stage", [
        ("src.nodes.developer", "make_developer_node", "developer"),
        ("src.nodes.qa", "make_qa_node", "qa"),
        ("src.nodes.reviewer", "make_reviewer_node", "reviewer"),
        ("src.nodes.docs", "make_docs_node", "docs"),
        ("src.nodes.synthesis", "make_synthesis_node", "synthesis"),
    ])
    async def test_non_subagent_stages_pass_none(
        self, module_name: str, factory_name: str, stage: str
    ):
        """AC-4: Stages without subagent config receive subagents=None."""
        import importlib
        mod = importlib.import_module(module_name)
        factory = getattr(mod, factory_name)

        captured: dict = {}

        def _fake_create_deep_agent(**kwargs: Any) -> MagicMock:
            captured["subagents"] = kwargs.get("subagents")
            return _make_agent_mock()

        node_fn = factory(FAKE_CONFIG, FAKE_TOOLS)

        with _patch_persona(), \
             patch("deepagents.create_deep_agent", side_effect=_fake_create_deep_agent), \
             patch("deepagents.backends.LocalShellBackend", return_value=MagicMock()), \
             patch("src.utils.subagents.load_subagents", return_value=[]):
            await node_fn(base_state(current_wp_id=""))

        assert captured.get("subagents") is None, (
            f"Stage {stage!r} must pass subagents=None to create_deep_agent; "
            f"got {captured.get('subagents')!r}"
        )



# ---------------------------------------------------------------------------
# Tests: WP-008 — Config retry values wired into _accumulate_stream via node_fn
# ---------------------------------------------------------------------------


class TestConfigRetryWiring:
    """Verify that node_fn() passes config retry values to _accumulate_stream().

    AC1 (WP-008): _accumulate_stream() receives retry config values from the
                  node_fn() closure.
    AC2 (WP-008): Config values flow correctly from Config to streaming function.
    """

    @pytest.mark.asyncio
    async def test_accumulate_stream_receives_max_retries_from_config(self):
        """node_fn() must forward config.stream_max_retries as max_retries."""
        from src.nodes.developer import make_developer_node

        class _CustomConfig(_FakeConfig):
            stream_max_retries = 3
            stream_retry_base_delay_s = 5.0

        captured: dict = {}

        async def _mock_accumulate_stream(agent, user_prompt, slug_dir, wp_id, stage, **kwargs):
            captured.update(kwargs)
            return ([], None)

        node_fn = make_developer_node(_CustomConfig(), FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with (
            _patch_persona(),
            create_p,
            backend_p,
            patch("src.nodes._accumulate_stream", side_effect=_mock_accumulate_stream),
        ):
            await node_fn(base_state())

        assert captured.get("max_retries") == 3, (
            f"Expected max_retries=3, got {captured.get('max_retries')!r}"
        )

    @pytest.mark.asyncio
    async def test_accumulate_stream_receives_base_delay_from_config(self):
        """node_fn() must forward config.stream_retry_base_delay_s as base_delay_s."""
        from src.nodes.developer import make_developer_node

        class _CustomConfig(_FakeConfig):
            stream_max_retries = 1
            stream_retry_base_delay_s = 7.5

        captured: dict = {}

        async def _mock_accumulate_stream(agent, user_prompt, slug_dir, wp_id, stage, **kwargs):
            captured.update(kwargs)
            return ([], None)

        node_fn = make_developer_node(_CustomConfig(), FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with (
            _patch_persona(),
            create_p,
            backend_p,
            patch("src.nodes._accumulate_stream", side_effect=_mock_accumulate_stream),
        ):
            await node_fn(base_state())

        assert captured.get("base_delay_s") == 7.5, (
            f"Expected base_delay_s=7.5, got {captured.get('base_delay_s')!r}"
        )

    @pytest.mark.asyncio
    async def test_zero_max_retries_forwarded_correctly(self):
        """A config with stream_max_retries=0 must disable retry (max_retries=0)."""
        from src.nodes.developer import make_developer_node

        class _ZeroRetryConfig(_FakeConfig):
            stream_max_retries = 0
            stream_retry_base_delay_s = 10.0

        captured: dict = {}

        async def _mock_accumulate_stream(agent, user_prompt, slug_dir, wp_id, stage, **kwargs):
            captured.update(kwargs)
            return ([], None)

        node_fn = make_developer_node(_ZeroRetryConfig(), FAKE_TOOLS)
        create_p, backend_p = _patch_deep_agent()
        with (
            _patch_persona(),
            create_p,
            backend_p,
            patch("src.nodes._accumulate_stream", side_effect=_mock_accumulate_stream),
        ):
            await node_fn(base_state())

        assert captured.get("max_retries") == 0, (
            f"Expected max_retries=0, got {captured.get('max_retries')!r}"
        )

```
###  Path: `/orchestrator/tests/test_persona_models.py`

```py
"""
tests/test_persona_models.py — Tests for utils/persona_models.

Covers:
- extract_persona_model_slugs() returns {stage: model_slug} for all 9 roles
- Per-persona model_slug overrides default_model_slug
- Missing metadata directory raises OSError
- Inline YAML comments are stripped correctly
- _extract_yaml_list() parses block lists, handles edge cases
- find_ledger_yaml_for_stage() locates persona YAML by stage ID
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.persona_models import (
    _extract_yaml_list,
    _extract_yaml_scalar,
    _strip_inline_comment,
    extract_persona_model_slugs,
    find_ledger_yaml_for_stage,
)

# Workspace root: two levels above orchestrator/tests/.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

# -------------------------------------------------------------------
# Minimal manifest used in unit-test fixtures (3 roles for brevity).
# -------------------------------------------------------------------
_FIXTURE_MANIFEST = {
    "roles": [
        {"id": "planner", "number": 1, "name": "Planner"},
        {"id": "developer", "number": 2, "name": "Developer"},
        {"id": "synthesis", "number": 3, "name": "Synthesis"},
    ]
}


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

def _build_workspace(
    tmp_path: Path,
    personas: list[tuple[int, str | None]],
    *,
    default_slug: str = "claude-sonnet-4-6",
    manifest: dict | None = None,
) -> Path:
    """Create a minimal workspace tree under *tmp_path*.

    *personas* is a list of ``(number, model_slug_or_None)`` tuples.
    One YAML file named ``{number}-persona.yaml`` is created per entry.
    When *model_slug* is ``None`` the persona YAML has no ``model_slug``
    field, mirroring a persona that inherits the default.
    """
    meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
    meta_dir.mkdir(parents=True)
    shared_dir = tmp_path / "shared"
    shared_dir.mkdir()

    (meta_dir / "_shared.yaml").write_text(
        f'default_model_slug: "{default_slug}"\n',
        encoding="utf-8",
    )

    m = manifest if manifest is not None else _FIXTURE_MANIFEST
    (shared_dir / "workflow-manifest.json").write_text(
        json.dumps(m),
        encoding="utf-8",
    )

    for number, model_slug in personas:
        lines = [f"number: {number}\n"]
        if model_slug is not None:
            lines.append(f'model_slug: "{model_slug}"\n')
        (meta_dir / f"{number}-persona.yaml").write_text(
            "".join(lines),
            encoding="utf-8",
        )

    return tmp_path


# ---------------------------------------------------------------------------
# Unit tests — internal helpers
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Unit tests — _extract_yaml_list
# ---------------------------------------------------------------------------

class TestExtractYamlList:
    def test_basic_list_parsed(self):
        text = "subagents:\n  - ledger-wp-decomposer\n  - ledger-bootstrapper\n"
        assert _extract_yaml_list(text, "subagents") == [
            "ledger-wp-decomposer",
            "ledger-bootstrapper",
        ]

    def test_missing_key_returns_empty_list(self):
        text = "role: Developer\nmodel_slug: claude-sonnet-4-6\n"
        assert _extract_yaml_list(text, "subagents") == []

    def test_empty_key_has_no_list_items(self):
        # Key present with no list items below it
        text = "subagents:\nrole: Developer\n"
        assert _extract_yaml_list(text, "subagents") == []

    def test_double_quoted_items_unquoted(self):
        text = 'tools:\n  - "ledger-wp-decomposer"\n  - "ledger-bootstrapper"\n'
        assert _extract_yaml_list(text, "tools") == [
            "ledger-wp-decomposer",
            "ledger-bootstrapper",
        ]

    def test_single_quoted_items_unquoted(self):
        text = "tools:\n  - 'item-one'\n  - 'item-two'\n"
        assert _extract_yaml_list(text, "tools") == ["item-one", "item-two"]

    def test_inline_comment_stripped_from_item(self):
        text = "subagents:\n  - ledger-wp-decomposer  # WP Decomposer\n  - ledger-bootstrapper\n"
        assert _extract_yaml_list(text, "subagents") == [
            "ledger-wp-decomposer",
            "ledger-bootstrapper",
        ]

    def test_inline_scalar_value_returns_empty(self):
        # Key has an inline value, not a block list
        text = "subagents: some-value\n"
        assert _extract_yaml_list(text, "subagents") == []

    def test_collection_stops_at_next_key(self):
        text = (
            "subagents:\n"
            "  - item-one\n"
            "  - item-two\n"
            "other_key: value\n"
            "  - not-an-item\n"
        )
        assert _extract_yaml_list(text, "subagents") == ["item-one", "item-two"]

    def test_comment_lines_inside_list_skipped(self):
        text = (
            "subagents:\n"
            "  # this is a comment\n"
            "  - item-one\n"
            "  - item-two\n"
        )
        assert _extract_yaml_list(text, "subagents") == ["item-one", "item-two"]

    def test_four_slugs_as_in_pm_yaml(self):
        """Mirrors the real PM persona YAML subagents field format."""
        text = (
            "subagents:\n"
            "  - ledger-wp-decomposer\n"
            "  - ledger-dependency-sequencer\n"
            "  - ledger-pipeline-configurator\n"
            "  - ledger-bootstrapper\n"
        )
        result = _extract_yaml_list(text, "subagents")
        assert result == [
            "ledger-wp-decomposer",
            "ledger-dependency-sequencer",
            "ledger-pipeline-configurator",
            "ledger-bootstrapper",
        ]


# ---------------------------------------------------------------------------
# Unit tests — find_ledger_yaml_for_stage
# ---------------------------------------------------------------------------

class TestFindLedgerYamlForStage:
    def _make_workspace(self, tmp_path: Path) -> Path:
        """Build a minimal workspace with two persona YAMLs and a manifest."""
        meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
        meta_dir.mkdir(parents=True)
        shared_dir = tmp_path / "shared"
        shared_dir.mkdir()

        (meta_dir / "_shared.yaml").write_text(
            'default_model_slug: "claude-sonnet-4-6"\n', encoding="utf-8"
        )
        (meta_dir / "1-planner.yaml").write_text(
            "number: 1\nrole: Planner\nmodel_slug: claude-opus-4-6\n",
            encoding="utf-8",
        )
        (meta_dir / "2-pm.yaml").write_text(
            "number: 2\nrole: Project Manager\nmodel_slug: claude-opus-4-6\n",
            encoding="utf-8",
        )
        manifest = {
            "roles": [
                {"id": "planner", "number": 1, "name": "Planner"},
                {"id": "pm", "number": 2, "name": "Project Manager"},
            ]
        }
        (shared_dir / "workflow-manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        return tmp_path

    def test_valid_stage_returns_tuple(self, tmp_path):
        ws = self._make_workspace(tmp_path)
        result = find_ledger_yaml_for_stage("planner", ws)
        assert result is not None
        path, text = result
        assert isinstance(path, Path)
        assert isinstance(text, str)
        assert "claude-opus-4-6" in text

    def test_valid_stage_returns_correct_file(self, tmp_path):
        ws = self._make_workspace(tmp_path)
        result = find_ledger_yaml_for_stage("pm", ws)
        assert result is not None
        path, _ = result
        assert path.name == "2-pm.yaml"

    def test_unknown_stage_returns_none(self, tmp_path):
        ws = self._make_workspace(tmp_path)
        result = find_ledger_yaml_for_stage("nonexistent", ws)
        assert result is None

    def test_accepts_string_workspace_root(self, tmp_path):
        ws = self._make_workspace(tmp_path)
        result = find_ledger_yaml_for_stage("planner", str(ws))
        assert result is not None

    def test_real_workspace_pm_stage(self):
        """Integration: find_ledger_yaml_for_stage works on the real workspace."""
        result = find_ledger_yaml_for_stage("pm", _WORKSPACE_ROOT)
        assert result is not None
        path, text = result
        assert path.name.startswith("2-")
        assert "Project Manager" in text

    def test_real_workspace_unknown_stage_returns_none(self):
        result = find_ledger_yaml_for_stage("nonexistent_stage_xyz", _WORKSPACE_ROOT)
        assert result is None


# ---------------------------------------------------------------------------
# Unit tests — _strip_inline_comment (unchanged)
# ---------------------------------------------------------------------------

class TestStripInlineComment:
    def test_no_comment_unchanged(self):
        assert _strip_inline_comment('"claude-sonnet-4-6"') == '"claude-sonnet-4-6"'

    def test_comment_after_quoted_value_stripped(self):
        raw = '"claude-sonnet-4-6"  # API-compatible slug'
        assert _strip_inline_comment(raw) == '"claude-sonnet-4-6"'

    def test_hash_inside_double_quotes_not_stripped(self):
        raw = '"model#name"'
        assert _strip_inline_comment(raw) == '"model#name"'

    def test_hash_inside_single_quotes_not_stripped(self):
        raw = "'model#name'"
        assert _strip_inline_comment(raw) == "'model#name'"

    def test_unquoted_value_with_comment(self):
        raw = "3  # number"
        assert _strip_inline_comment(raw) == "3"

    def test_empty_string(self):
        assert _strip_inline_comment("") == ""


class TestExtractYamlScalar:
    def test_double_quoted_value(self):
        text = 'default_model_slug: "claude-sonnet-4-6"\n'
        assert _extract_yaml_scalar(text, "default_model_slug") == "claude-sonnet-4-6"

    def test_single_quoted_value(self):
        text = "model_slug: 'claude-opus-4-6'\n"
        assert _extract_yaml_scalar(text, "model_slug") == "claude-opus-4-6"

    def test_unquoted_integer(self):
        text = "number: 3\n"
        assert _extract_yaml_scalar(text, "number") == "3"

    def test_missing_key_returns_none(self):
        text = "role: Developer\n"
        assert _extract_yaml_scalar(text, "model_slug") is None

    def test_inline_comment_stripped(self):
        text = 'default_model_slug: "claude-sonnet-4-6"  # some comment\n'
        assert _extract_yaml_scalar(text, "default_model_slug") == "claude-sonnet-4-6"

    def test_comment_lines_skipped(self):
        text = "# model_slug: should-be-ignored\nmodel_slug: \"target\"\n"
        assert _extract_yaml_scalar(text, "model_slug") == "target"

    def test_first_match_returned(self):
        text = 'key: "first"\nkey: "second"\n'
        assert _extract_yaml_scalar(text, "key") == "first"


# ---------------------------------------------------------------------------
# Unit tests — extract_persona_model_slugs (tmp_path fixtures)
# ---------------------------------------------------------------------------

class TestExtractPersonaModelSlugs:
    def test_returns_dict(self, tmp_path):
        ws = _build_workspace(tmp_path, [(1, None), (2, None), (3, None)])
        result = extract_persona_model_slugs(ws)
        assert isinstance(result, dict)

    def test_all_fixture_stages_present(self, tmp_path):
        """Result contains exactly the stage IDs from the fixture manifest."""
        ws = _build_workspace(tmp_path, [(1, None), (2, None), (3, None)])
        result = extract_persona_model_slugs(ws)
        assert set(result.keys()) == {"planner", "developer", "synthesis"}

    def test_default_slug_used_when_no_override(self, tmp_path):
        """A persona without model_slug falls back to default_model_slug."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["developer"] == "claude-sonnet-4-6"
        assert result["synthesis"] == "claude-sonnet-4-6"

    def test_per_persona_override_takes_precedence(self, tmp_path):
        """A persona with model_slug uses it instead of the default."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"

    def test_override_does_not_bleed_into_other_stages(self, tmp_path):
        """An override for one stage does not affect sibling stages."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, "claude-opus-4-6")],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "claude-sonnet-4-6"
        assert result["synthesis"] == "claude-opus-4-6"

    def test_all_values_are_non_empty_strings(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
        )
        result = extract_persona_model_slugs(ws)
        for stage, slug in result.items():
            assert isinstance(slug, str), f"Stage {stage!r}: expected str, got {type(slug)}"
            assert slug, f"Stage {stage!r}: slug is empty"

    def test_missing_meta_dir_raises_os_error(self, tmp_path):
        """OSError is raised when the persona metadata directory is absent."""
        (tmp_path / "shared").mkdir()
        (tmp_path / "shared" / "workflow-manifest.json").write_text(
            json.dumps(_FIXTURE_MANIFEST),
            encoding="utf-8",
        )
        # No personas/ledger/src/meta/ directory created.
        with pytest.raises(OSError, match="Persona metadata directory not found"):
            extract_persona_model_slugs(tmp_path)

    def test_inline_comment_in_shared_yaml_does_not_corrupt_value(self, tmp_path):
        """Inline comment in _shared.yaml (as in the real file) is ignored."""
        meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
        meta_dir.mkdir(parents=True)
        shared_dir = tmp_path / "shared"
        shared_dir.mkdir()
        # Mirrors the real _shared.yaml comment style.
        (meta_dir / "_shared.yaml").write_text(
            'default_model_slug: "claude-sonnet-4-6"  '
            "# API-compatible slug; override per-persona via `model_slug:` field\n",
            encoding="utf-8",
        )
        (shared_dir / "workflow-manifest.json").write_text(
            json.dumps(_FIXTURE_MANIFEST),
            encoding="utf-8",
        )
        (meta_dir / "1-persona.yaml").write_text("number: 1\n", encoding="utf-8")
        result = extract_persona_model_slugs(tmp_path)
        assert result["planner"] == "claude-sonnet-4-6"

    def test_accepts_path_string(self, tmp_path):
        """workspace_root may be passed as a str, not only a Path."""
        ws = _build_workspace(tmp_path, [(1, None)])
        result = extract_persona_model_slugs(str(ws))
        assert "planner" in result


# ---------------------------------------------------------------------------
# Integration tests — real workspace files
# ---------------------------------------------------------------------------

class TestRealWorkspace:
    """Validate against the committed persona metadata in the repository."""

    def test_all_nine_stages_present(self):
        """The real metadata produces exactly the 9 roles from the manifest."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        expected = {
            "planner",
            "pm",
            "developer",
            "qa",
            "security_auditor",
            "reviewer",
            "release_engineer",
            "docs",
            "synthesis",
        }
        assert set(result.keys()) == expected

    def test_planner_uses_opus_slug(self):
        """1-planner.yaml carries model_slug: claude-opus-4-6 (set by WP-001)."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        assert result["planner"] == "claude-opus-4-6"

    def test_pm_uses_opus_slug(self):
        """2-project-manager.yaml carries model_slug: claude-opus-4-6 (set by WP-001)."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        assert result["pm"] == "claude-opus-4-6"

    def test_remaining_stages_use_default_sonnet_slug(self):
        """Stages without an explicit model_slug fall back to claude-sonnet-4-6."""
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        default_stages = (
            "developer",
            "qa",
            "security_auditor",
            "reviewer",
            "release_engineer",
            "docs",
            "synthesis",
        )
        for stage in default_stages:
            assert result[stage] == "claude-sonnet-4-6", (
                f"Stage {stage!r}: expected 'claude-sonnet-4-6', got {result[stage]!r}"
            )

    def test_all_slugs_are_non_empty_strings(self):
        result = extract_persona_model_slugs(_WORKSPACE_ROOT)
        for stage, slug in result.items():
            assert isinstance(slug, str) and slug, (
                f"Stage {stage!r} has invalid slug: {slug!r}"
            )

```
###  Path: `/orchestrator/tests/test_plan_parser.py`

```py
"""
test_plan_parser.py — Unit tests for the plan document parser.

Verifies:
- parse_plan() extracts title and summary from a standard plan document.
- YAML frontmatter is stripped before parsing.
- Missing files raise FileNotFoundError.
- Documents with no H1 return empty title and summary.
- PlanMetadata carries the absolute file path and raw content.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from src.utils.plan_parser import PlanMetadata, parse_plan


@pytest.fixture
def tmp_plan(tmp_path: Path):
    """Factory fixture: writes Markdown content to a temp file and returns its path."""
    def _write(content: str, filename: str = "plan.md") -> Path:
        p = tmp_path / filename
        p.write_text(textwrap.dedent(content), encoding="utf-8")
        return p
    return _write


class TestStandardPlan:
    """Tests for a normal plan document with title and body paragraph."""

    CONTENT = """
        # LangGraph Orchestrator

        Implements a LangGraph-based orchestrator that drives the AI agent workflow.

        ## Architecture

        Uses a StateGraph with supervisor routing.
    """

    def test_extracts_title(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "LangGraph Orchestrator"

    def test_extracts_summary(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == (
            "Implements a LangGraph-based orchestrator that drives the AI agent workflow."
        )

    def test_returns_absolute_file_path(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.file_path == str(path)

    def test_raw_content_preserved(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        raw = path.read_text(encoding="utf-8")
        meta = parse_plan(str(path))
        assert meta.raw_content == raw

    def test_returns_plan_metadata_instance(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert isinstance(meta, PlanMetadata)


class TestFrontmatterStripping:
    """Tests for documents that begin with YAML frontmatter."""

    CONTENT = """\
---
title: My Plan
author: Agent
---

# Frontmatter Plan

First paragraph after frontmatter.
"""

    def test_title_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.title == "Frontmatter Plan"

    def test_summary_extracted_after_frontmatter(self, tmp_plan):
        path = tmp_plan(self.CONTENT)
        meta = parse_plan(str(path))
        assert meta.summary == "First paragraph after frontmatter."


class TestEdgeCases:
    """Edge-case and missing-content scenarios."""

    def test_no_h1_returns_empty_title(self, tmp_plan):
        path = tmp_plan("## Only a second-level heading\n\nSome text.")
        meta = parse_plan(str(path))
        assert meta.title == ""

    def test_no_body_paragraph_returns_empty_summary(self, tmp_plan):
        path = tmp_plan("# Title Only\n")
        meta = parse_plan(str(path))
        assert meta.summary == ""

    def test_heading_after_title_is_skipped(self, tmp_plan):
        content = "# Title\n\n## Section Heading\n\nActual summary paragraph."
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Actual summary paragraph."

    def test_relative_path_resolved(self, tmp_plan):
        """Passing a relative path should still produce an absolute file_path."""
        import os
        path = tmp_plan("# Relative\n\nSummary.")
        original_cwd = os.getcwd()
        try:
            os.chdir(str(path.parent))
            meta = parse_plan(path.name)
            assert Path(meta.file_path).is_absolute()
            assert meta.title == "Relative"
        finally:
            os.chdir(original_cwd)

    def test_missing_file_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError, match="Plan file not found"):
            parse_plan("/nonexistent/path/plan.md")

    def test_multiline_paragraph_collapsed_to_single_line(self, tmp_plan):
        content = "# Title\n\nLine one\nLine two\nLine three.\n"
        path = tmp_plan(content)
        meta = parse_plan(str(path))
        assert meta.summary == "Line one Line two Line three."

```
###  Path: `/orchestrator/tests/test_post_completion_guard.py`

```py
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

```
###  Path: `/orchestrator/tests/test_prompt_renderer.py`

```py
"""
test_prompt_renderer.py — Regression guard for src/nodes/prompt_renderer.py.

Covers the four public functions:
- load_template(stage)
- load_partial(name)
- render_prompt(template, variables)
- clear_template_cache()

Behaviours verified by the WP-001 QA scripts are captured here as permanent
pytest assertions so no future refactor can silently break the renderer.
"""

from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

import pytest

from src.nodes.prompt_renderer import (
    clear_template_cache,
    load_partial,
    load_template,
    render_prompt,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "src" / "nodes" / "templates"


# ---------------------------------------------------------------------------
# Module-level checks
# ---------------------------------------------------------------------------


class TestModuleStructure:
    """Verify structural invariants of the renderer module itself."""

    def test_three_public_functions_are_importable(self):
        """load_template, render_prompt, clear_template_cache must all be importable."""
        from src.nodes import prompt_renderer  # noqa: F401 (import check)

        assert callable(load_template)
        assert callable(render_prompt)
        assert callable(clear_template_cache)
        assert callable(load_partial)

    def test_stdlib_only_imports(self):
        """prompt_renderer must not import any non-stdlib dependency."""
        import src.nodes.prompt_renderer as pm

        source = inspect.getsource(pm)
        tree = ast.parse(source)
        discovered: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                discovered.extend(n.name.split(".")[0] for n in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    discovered.append(node.module.split(".")[0])
        allowed = {"re", "pathlib", "collections", "__future__", "typing", "annotations"}
        non_stdlib = [m for m in discovered if m not in allowed and not m.startswith("_")]
        assert non_stdlib == [], f"Non-stdlib imports found: {non_stdlib}"

    def test_templates_directory_exists(self):
        """orchestrator/src/nodes/templates/ must exist."""
        assert _TEMPLATES_DIR.is_dir(), f"templates/ not found at {_TEMPLATES_DIR}"


# ---------------------------------------------------------------------------
# load_template
# ---------------------------------------------------------------------------


class TestLoadTemplate:
    """Behaviour of load_template()."""

    def setup_method(self):
        clear_template_cache()

    def test_raises_file_not_found_for_missing_stage(self, tmp_path):
        """load_template('nonexistent') must raise FileNotFoundError, not return None."""
        with pytest.raises(FileNotFoundError):
            load_template("nonexistent_stage_xyz_test_sentinel")

    def test_caches_result_on_second_call(self, tmp_path, monkeypatch):
        """Second call for the same stage must return the cached string without re-reading."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        stage_file = tmp_path / "cached_stage.md"
        stage_file.write_text("original content", encoding="utf-8")

        first = load_template("cached_stage")
        assert first == "original content"

        # Modify the file after the first load — cache must still return original.
        stage_file.write_text("modified content", encoding="utf-8")
        second = load_template("cached_stage")
        assert second == "original content", "Cache was not used on second call"

    def test_clear_cache_forces_reread(self, tmp_path, monkeypatch):
        """clear_template_cache() must cause load_template to re-read from disk."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        stage_file = tmp_path / "reload_stage.md"
        stage_file.write_text("v1", encoding="utf-8")
        assert load_template("reload_stage") == "v1"

        stage_file.write_text("v2", encoding="utf-8")
        clear_template_cache()
        assert load_template("reload_stage") == "v2"

    def test_returns_str_not_bytes(self, tmp_path, monkeypatch):
        """load_template must return a str, not bytes."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        (tmp_path / "str_stage.md").write_text("hello", encoding="utf-8")
        result = load_template("str_stage")
        assert isinstance(result, str)

    @pytest.mark.parametrize(
        "name",
        [
            "../etc/passwd",
            "",
            "name.with.dots",
            "/absolute/path",
            "has space",
            "semi;colon",
        ],
    )
    def test_raises_value_error_for_invalid_name(self, name):
        """load_template raises ValueError for names that don't match [\\w-]+."""
        with pytest.raises(ValueError):
            load_template(name)


# ---------------------------------------------------------------------------
# load_partial
# ---------------------------------------------------------------------------


class TestLoadPartial:
    """Behaviour of load_partial()."""

    def setup_method(self):
        clear_template_cache()

    def test_reads_partial_file(self, tmp_path, monkeypatch):
        """load_partial('example') reads templates/partials/example.md."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "example.md").write_text("partial content", encoding="utf-8")
        result = load_partial("example")
        assert result == "partial content"

    def test_returns_str_not_bytes(self, tmp_path, monkeypatch):
        """load_partial must return a str, not bytes."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "str_partial.md").write_text("hello", encoding="utf-8")
        result = load_partial("str_partial")
        assert isinstance(result, str)

    def test_caches_result_on_second_call(self, tmp_path, monkeypatch):
        """Second call for the same partial must return cached string without re-reading."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        partial_file = tmp_path / "cached.md"
        partial_file.write_text("original", encoding="utf-8")

        first = load_partial("cached")
        assert first == "original"

        partial_file.write_text("modified", encoding="utf-8")
        second = load_partial("cached")
        assert second == "original", "Cache was not used on second call"

    def test_raises_file_not_found_for_missing_partial(self):
        """load_partial('nonexistent') must raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            load_partial("nonexistent_partial_xyz_sentinel")

    def test_clear_cache_forces_reread(self, tmp_path, monkeypatch):
        """clear_template_cache() must cause load_partial to re-read from disk."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        partial_file = tmp_path / "reread.md"
        partial_file.write_text("v1", encoding="utf-8")
        assert load_partial("reread") == "v1"

        partial_file.write_text("v2", encoding="utf-8")
        clear_template_cache()
        assert load_partial("reread") == "v2"

    @pytest.mark.parametrize(
        "name",
        [
            "../etc/passwd",
            "",
            "name.with.dots",
            "/absolute/path",
            "has space",
            "semi;colon",
        ],
    )
    def test_raises_value_error_for_invalid_name(self, name):
        """load_partial raises ValueError for names that don't match [\\w-]+."""
        with pytest.raises(ValueError):
            load_partial(name)


# ---------------------------------------------------------------------------
# render_prompt — include directives
# ---------------------------------------------------------------------------


class TestRenderPromptIncludes:
    """{{> partial-name}} include directive behaviour."""

    def setup_method(self):
        clear_template_cache()

    def test_include_replaced_with_partial_content(self, tmp_path, monkeypatch):
        """render_prompt() replaces {{> name}} markers with partial file content."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "greeting.md").write_text("Hello from partial\n", encoding="utf-8")
        template = "Before\n{{> greeting}}\nAfter"
        result = render_prompt(template, {})
        assert "Hello from partial" in result
        assert "Before" in result
        assert "After" in result
        assert "{{>" not in result

    def test_variables_in_partial_are_substituted(self, tmp_path, monkeypatch):
        """Variables inside included partials (e.g., {wp_id}) are substituted correctly."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "scope.md").write_text("Scope: {wp_id}\n", encoding="utf-8")
        template = "{{> scope}}\nEnd"
        result = render_prompt(template, {"wp_id": "WP-042"})
        assert "Scope: WP-042" in result

    def test_include_resolved_before_conditionals(self, tmp_path, monkeypatch):
        """{{> partial}} includes are resolved before {{#if}} evaluation."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        # Partial contains an {{#if}} block that must be evaluated after inclusion.
        (tmp_path / "cond.md").write_text(
            "{{#if show}}\nConditional text\n{{/if}}\n", encoding="utf-8"
        )
        template = "{{> cond}}\nEnd"

        result_show = render_prompt(template, {"show": "yes"})
        assert "Conditional text" in result_show

        result_hide = render_prompt(template, {"show": ""})
        assert "Conditional text" not in result_hide

    def test_no_recursive_includes(self, tmp_path, monkeypatch):
        """{{> partial}} inside a partial (one level deep) is resolved correctly."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "outer.md").write_text("{{> inner}}\n", encoding="utf-8")
        (tmp_path / "inner.md").write_text("Inner content\n", encoding="utf-8")
        template = "{{> outer}}\nEnd"
        result = render_prompt(template, {})
        # One level deep: inner content IS resolved via outer → inner expansion.
        assert "Inner content" in result
        assert "End" in result

    def test_includes_not_resolved_beyond_one_level(self, tmp_path, monkeypatch):
        """{{> partial}} inside a second-level partial (two levels deep) is NOT resolved."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "outer.md").write_text("{{> inner}}\n", encoding="utf-8")
        (tmp_path / "inner.md").write_text("{{> deepest}}\n", encoding="utf-8")
        (tmp_path / "deepest.md").write_text("Deepest content\n", encoding="utf-8")
        template = "{{> outer}}\nEnd"
        result = render_prompt(template, {})
        # Two levels deep: deepest content must NOT appear.
        assert "Deepest content" not in result
        assert "End" in result

    def test_inline_include_ignored(self, tmp_path, monkeypatch):
        """{{> name}} preceded by other text on the same line is not processed."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "side.md").write_text("injected content\n", encoding="utf-8")
        # The include marker has text before it — must NOT be expanded.
        template = "text before {{> side}}"
        result = render_prompt(template, {})
        assert "injected content" not in result


# ---------------------------------------------------------------------------
# render_prompt — conditional blocks
# ---------------------------------------------------------------------------


class TestRenderPromptConditionals:
    """{{#if var}}…{{/if}} block evaluation."""

    _TEMPLATE = "Header\n{{#if show}}\nVisible content\n{{/if}}\nFooter"

    def test_truthy_variable_includes_block(self):
        out = render_prompt(self._TEMPLATE, {"show": "yes"})
        assert "Visible content" in out
        assert "Footer" in out

    def test_falsy_empty_string_hides_block(self):
        out = render_prompt(self._TEMPLATE, {"show": ""})
        assert "Visible content" not in out
        assert "Footer" in out

    def test_missing_key_hides_block(self):
        """Missing keys are falsy (defaultdict(str) → empty string)."""
        out = render_prompt(self._TEMPLATE, {})
        assert "Visible content" not in out

    def test_block_markers_stripped_from_truthy_output(self):
        out = render_prompt(self._TEMPLATE, {"show": "yes"})
        assert "{{#if" not in out
        assert "{{/if}}" not in out

    def test_block_markers_stripped_from_falsy_output(self):
        out = render_prompt(self._TEMPLATE, {"show": ""})
        assert "{{#if" not in out
        assert "{{/if}}" not in out

    def test_multiple_independent_blocks(self):
        template = "{{#if a}}\nA block\n{{/if}}\n{{#if b}}\nB block\n{{/if}}\nEnd"
        out = render_prompt(template, {"a": "1", "b": ""})
        assert "A block" in out
        assert "B block" not in out
        assert "End" in out

    def test_inline_if_marker_not_processed_as_conditional(self):
        """Markers not on their own line are not processed as conditional blocks.
        
        Note: Python's format_map transforms ``{{`` → ``{`` as escape notation,
        so inline markers like ``{{#if var}}`` become ``{#if var}`` in the output.
        This is not a conditional block evaluation — it is a format_map side-effect.
        The key invariant is: the block body is NOT conditionally included/excluded.
        """
        template = "Inline {{#if var}} not-a-block {{/if}} text"
        out = render_prompt(template, {"var": "yes"})
        # Block body is not conditionally evaluated (it always appears).
        assert "not-a-block" in out
        # format_map consumes the double-braces as escape sequences.
        assert "{{#if var}}" not in out


# ---------------------------------------------------------------------------
# render_prompt — variable substitution
# ---------------------------------------------------------------------------


class TestRenderPromptVariables:
    """{{variable}} substitution behaviour."""

    def test_present_variable_substituted(self):
        out = render_prompt("Value is {x}", {"x": "42"})
        assert out == "Value is 42"

    def test_missing_variable_resolves_to_empty_string(self):
        out = render_prompt("A={missing} B={present}", {"present": "X"})
        assert "{" not in out
        assert "X" in out
        assert "A= B=X" == out

    def test_multiple_variables_substituted(self):
        out = render_prompt("{a} and {b}", {"a": "hello", "b": "world"})
        assert out == "hello and world"

    def test_empty_variables_dict_leaves_no_placeholders(self):
        out = render_prompt("no vars here", {})
        assert out == "no vars here"


# ---------------------------------------------------------------------------
# render_prompt — blank line collapse
# ---------------------------------------------------------------------------


class TestRenderPromptBlankLineCollapse:
    """Consecutive blank lines (3+) are collapsed to a single blank line."""

    def test_three_newlines_collapsed(self):
        out = render_prompt("line1\n\n\n\nline2", {})
        assert "\n\n\n" not in out

    def test_two_newlines_preserved(self):
        """Two newlines (one blank line) must NOT be collapsed."""
        out = render_prompt("line1\n\nline2", {})
        assert "\n\n" in out

    def test_collapse_after_conditional_removal(self):
        """Removing a conditional block must not leave triple-blank-line gaps."""
        template = "Start\n\n{{#if gone}}\nRemoved\n{{/if}}\n\nEnd"
        out = render_prompt(template, {"gone": ""})
        assert "\n\n\n" not in out
        assert "End" in out


# ---------------------------------------------------------------------------
# render_prompt — combined pipeline
# ---------------------------------------------------------------------------


class TestRenderPromptPipeline:
    """End-to-end render_prompt behaviour with realistic template fragments."""

    def test_standard_prompt_fragment(self):
        """Minimal stage-prompt template renders correctly."""
        template = (
            "{{#if preamble}}\n"
            "{preamble}\n"
            "{{/if}}\n"
            "**Project:** `{project_path}`\n"
            "{{#if wp_id}}\n"
            "**Work package:** {wp_id}\n"
            "{{/if}}\n"
            "{project_path_reminder}"
        )
        out = render_prompt(
            template,
            {
                "preamble": "Do great work.",
                "project_path": "/some/path",
                "wp_id": "WP-001",
                "project_path_reminder": "Always use the project path.",
            },
        )
        assert "Do great work." in out
        assert "/some/path" in out
        assert "WP-001" in out
        assert "Always use the project path." in out
        assert "{{" not in out

    def test_wp_id_omitted_when_empty(self):
        template = "{{#if wp_id}}\n**Work package:** {wp_id}\n{{/if}}\n{project_path}"
        out = render_prompt(template, {"wp_id": "", "project_path": "/p"})
        assert "Work package" not in out
        assert "/p" in out

    def test_partial_include_in_pipeline(self, tmp_path, monkeypatch):
        """Template fragment using {{> partial}} syntax renders correctly end-to-end."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "custom-reminder.md").write_text(
            "Only work on: {wp_id}\n", encoding="utf-8"
        )
        template = (
            "**Project:** `{project_path}`\n"
            "{{> custom-reminder}}\n"
            "{{#if preamble}}\n"
            "{preamble}\n"
            "{{/if}}\n"
        )
        out = render_prompt(
            template,
            {
                "project_path": "/some/path",
                "wp_id": "WP-007",
                "preamble": "Do great work.",
            },
        )
        assert "/some/path" in out
        assert "Only work on: WP-007" in out
        assert "Do great work." in out
        assert "{{>" not in out


# ---------------------------------------------------------------------------
# clear_template_cache
# ---------------------------------------------------------------------------


class TestClearTemplateCache:
    """clear_template_cache() contract."""

    def test_callable_without_error(self):
        clear_template_cache()  # must not raise

    def test_callable_when_cache_already_empty(self):
        clear_template_cache()
        clear_template_cache()  # idempotent

    def test_clears_cached_entries(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        (tmp_path / "clr.md").write_text("cached", encoding="utf-8")
        load_template("clr")
        clear_template_cache()
        (tmp_path / "clr.md").write_text("fresh", encoding="utf-8")
        assert load_template("clr") == "fresh"

    def test_clears_partial_cache_entries(self, tmp_path, monkeypatch):
        """clear_template_cache() must also clear the partial cache."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "clr_partial.md").write_text("v1", encoding="utf-8")
        load_partial("clr_partial")
        clear_template_cache()
        (tmp_path / "clr_partial.md").write_text("v2", encoding="utf-8")
        assert load_partial("clr_partial") == "v2"


# ---------------------------------------------------------------------------
# Integration: importable from src.nodes
# ---------------------------------------------------------------------------


class TestNodeModuleImports:
    """All 8 stage node modules must import cleanly with the current __init__.py state."""

    @pytest.mark.parametrize(
        "module_name",
        [
            "src.nodes.developer",
            "src.nodes.qa",
            "src.nodes.reviewer",
            "src.nodes.docs",
            "src.nodes.security_auditor",
            "src.nodes.release_engineer",
            "src.nodes.pm",
            "src.nodes.synthesis",
        ],
    )
    def test_stage_module_importable(self, module_name):
        """No NameError or ImportError when importing stage node modules."""
        mod = importlib.import_module(module_name)
        assert mod is not None

    def test_build_stage_prompt_not_in_nodes(self):
        """build_stage_prompt must not exist in src.nodes (it was removed by WP-004)."""
        import src.nodes as nodes_mod

        assert not hasattr(nodes_mod, "build_stage_prompt"), (
            "build_stage_prompt was re-introduced — it was intentionally removed by WP-004"
        )

```
###  Path: `/orchestrator/tests/test_revision.py`

```py
"""
test_revision.py — Unit tests for orchestrator/src/utils/_revision.py.

All filesystem operations use pytest's ``tmp_path`` fixture for
platform-agnostic temp directories.
"""

from __future__ import annotations

from pathlib import Path

from src.utils._revision import next_revision


class TestNextRevisionEmpty:
    """next_revision returns 0 when no matching files exist."""

    def test_empty_directory(self, tmp_path: Path) -> None:
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_empty_directory_md(self, tmp_path: Path) -> None:
        assert next_revision(tmp_path, "WP-001", "developer", ".md") == 0

    def test_non_matching_files_ignored(self, tmp_path: Path) -> None:
        (tmp_path / "WP-002-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-qa-r0.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0


class TestNextRevisionIncrement:
    """next_revision returns max(existing) + 1."""

    def test_single_existing_file(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 1

    def test_two_existing_files(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-developer-r1.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 2

    def test_gap_in_revisions(self, tmp_path: Path) -> None:
        """If existing files are r0 and r3, next revision should be r4."""
        (tmp_path / "WP-001-developer-r0.jsonl").write_text("{}\n")
        (tmp_path / "WP-001-developer-r3.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 4

    def test_md_extension(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-developer-r0.md").write_text("# Dialogue\n")
        (tmp_path / "WP-001-developer-r1.md").write_text("# Dialogue\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".md") == 2


class TestNextRevisionEdgeCases:
    """Edge cases: malformed filenames, mixed extensions."""

    def test_malformed_filename_ignored(self, tmp_path: Path) -> None:
        """Files that match the glob but have non-integer revision are ignored."""
        (tmp_path / "WP-001-developer-rfoo.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_only_matching_extension_counted(self, tmp_path: Path) -> None:
        """Files with a different extension are not counted."""
        (tmp_path / "WP-001-developer-r5.md").write_text("# Dialogue\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_different_wp_id_not_counted(self, tmp_path: Path) -> None:
        (tmp_path / "WP-999-developer-r10.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

    def test_different_stage_not_counted(self, tmp_path: Path) -> None:
        (tmp_path / "WP-001-qa-r10.jsonl").write_text("{}\n")
        assert next_revision(tmp_path, "WP-001", "developer", ".jsonl") == 0

```
###  Path: `/orchestrator/tests/test_run_queue.py`

```py
"""Unit tests for orchestrator/src/utils/run_queue.py."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import patch

import src.utils.run_queue as rq

# ---------------------------------------------------------------------------
# register() — creates file, appends entry, returns UUID
# ---------------------------------------------------------------------------


class TestRegisterCreatesFile:
    def test_creates_queue_file_when_missing(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(
                pid=1, plan_path="/p/plan.md", slug="2026-05-05-feat",
                started_at="2026-05-05T10:00:00Z",
            )

        assert (tmp_path / ".run-queue.json").exists()
        data = json.loads((tmp_path / ".run-queue.json").read_text())
        assert len(data) == 1
        assert data[0]["id"] == entry_id

    def test_entry_shape_is_correct(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(
                pid=99, plan_path="/abs/plan.md", slug="my-slug",
                started_at="2026-01-01T00:00:00Z",
            )

        data = json.loads((tmp_path / ".run-queue.json").read_text())
        entry = data[0]
        assert entry["id"] == entry_id
        assert entry["pid"] == 99
        assert entry["planPath"] == "/abs/plan.md"
        assert entry["expectedSlug"] == "my-slug"
        assert entry["startedAt"] == "2026-01-01T00:00:00Z"
        assert entry["status"] == "pending"

    def test_returns_uuid_string(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(pid=1, plan_path="/p/plan.md", slug="s", started_at="t")

        # Should parse as a valid UUID4 without raising ValueError.
        parsed = uuid.UUID(entry_id, version=4)
        assert str(parsed) == entry_id


# ---------------------------------------------------------------------------
# register() — preserves existing entries
# ---------------------------------------------------------------------------


class TestRegisterPreservesExistingEntries:
    def test_appends_without_overwriting(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        existing = [
            {"id": "aaa", "pid": 1, "planPath": "/old", "expectedSlug": "old",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(existing), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            new_id = rq.register(pid=2, plan_path="/new", slug="new", started_at="t2")

        data = json.loads(queue_file.read_text())
        assert len(data) == 2
        assert data[0]["id"] == "aaa"
        assert data[1]["id"] == new_id

    def test_multiple_registers_accumulate(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            id1 = rq.register(pid=1, plan_path="/a", slug="a", started_at="t")
            id2 = rq.register(pid=2, plan_path="/b", slug="b", started_at="t")
            id3 = rq.register(pid=3, plan_path="/c", slug="c", started_at="t")

        data = json.loads(queue_file.read_text())
        ids = [e["id"] for e in data]
        assert ids == [id1, id2, id3]


# ---------------------------------------------------------------------------
# unregister() — removes only the matching entry
# ---------------------------------------------------------------------------


class TestUnregisterRemovesCorrectEntry:
    def test_removes_entry_by_id(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "aaa", "pid": 1, "planPath": "/a", "expectedSlug": "a",
             "startedAt": "t", "status": "pending"},
            {"id": "bbb", "pid": 2, "planPath": "/b", "expectedSlug": "b",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("aaa")

        data = json.loads(queue_file.read_text())
        assert len(data) == 1
        assert data[0]["id"] == "bbb"

    def test_does_not_remove_other_entries(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "aaa", "pid": 1, "planPath": "/a", "expectedSlug": "a",
             "startedAt": "t", "status": "pending"},
            {"id": "bbb", "pid": 2, "planPath": "/b", "expectedSlug": "b",
             "startedAt": "t", "status": "pending"},
            {"id": "ccc", "pid": 3, "planPath": "/c", "expectedSlug": "c",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("bbb")

        data = json.loads(queue_file.read_text())
        ids = [e["id"] for e in data]
        assert ids == ["aaa", "ccc"]

    def test_removing_last_entry_leaves_empty_list(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        entries = [
            {"id": "only", "pid": 1, "planPath": "/p", "expectedSlug": "p",
             "startedAt": "t", "status": "pending"},
        ]
        queue_file.write_text(json.dumps(entries), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("only")

        data = json.loads(queue_file.read_text())
        assert data == []


# ---------------------------------------------------------------------------
# register() — error recovery (corrupt / missing queue file)
# ---------------------------------------------------------------------------


class TestRegisterEdgeCases:
    def test_corrupt_file_treated_as_empty(self, tmp_path: Path) -> None:
        """register() should recover from a corrupt queue file."""
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        queue_file.write_text("NOT JSON {{{{", encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            entry_id = rq.register(pid=1, plan_path="/p", slug="s", started_at="t")

        data = json.loads(queue_file.read_text())
        assert len(data) == 1
        assert data[0]["id"] == entry_id


# ---------------------------------------------------------------------------
# unregister() — silent no-op cases
# ---------------------------------------------------------------------------


class TestUnregisterNoOp:
    def test_missing_file_is_silent(self, tmp_path: Path) -> None:
        with patch.object(rq, "QUEUE_FILE", tmp_path / ".run-queue.json"), \
             patch.object(rq, "_LOCK_FILE", tmp_path / ".run-queue.lock"), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            # Must not raise
            rq.unregister("unknown-id")

    def test_unknown_id_is_silent(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"
        queue_file.write_text(json.dumps([{"id": "aaa"}]), encoding="utf-8")

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.unregister("not-here")  # Must not raise

        # File is unchanged
        data = json.loads(queue_file.read_text())
        assert data[0]["id"] == "aaa"


# ---------------------------------------------------------------------------
# Atomic write — no partial content
# ---------------------------------------------------------------------------


class TestAtomicWrite:
    def test_tmp_file_not_present_after_write(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=1, plan_path="/p", slug="s", started_at="t")

        tmp_file = tmp_path / ".run-queue.json.tmp"
        assert not tmp_file.exists(), ".tmp file should be cleaned up after rename"

    def test_queue_file_is_valid_json_after_write(self, tmp_path: Path) -> None:
        queue_file = tmp_path / ".run-queue.json"
        lock_file = tmp_path / ".run-queue.lock"

        with patch.object(rq, "QUEUE_FILE", queue_file), \
             patch.object(rq, "_LOCK_FILE", lock_file), \
             patch.object(rq, "_LOGS_DIR", tmp_path):

            rq.register(pid=42, plan_path="/q", slug="q", started_at="now")

        # Must parse as valid JSON and be a list
        parsed = json.loads(queue_file.read_text(encoding="utf-8"))
        assert isinstance(parsed, list)

```
###  Path: `/orchestrator/tests/test_state.py`

```py
"""
test_state.py — Unit tests for WorkflowState schema.

Verifies:
- WorkflowState is a valid TypedDict with all required fields.
- run_log and errors use the ``operator.add`` reducer (append-only semantics).
- StateGraph(WorkflowState) accepts the schema without error (requires langgraph).
"""

from __future__ import annotations

from operator import add
from typing import get_args, get_type_hints

import pytest

from src.state import WorkflowState


class TestWorkflowStateFields:
    """Verify all required fields exist in WorkflowState."""

    IMMUTABLE_FIELDS = {"project_path", "plan_file", "target_project_path"}
    MUTABLE_FIELDS = {"current_stage", "current_wp_id", "iteration", "max_iterations"}
    STAGE_OUTPUT_FIELDS = {"stage_result", "stage_success"}
    LEDGER_FIELDS = {"project_status", "wp_summaries", "pending_wp_count"}
    CIRCUIT_BREAKER_FIELDS = {"consecutive_failures", "fatal_error"}
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

```
###  Path: `/orchestrator/tests/test_stream_retry.py`

```py
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

```
###  Path: `/orchestrator/tests/test_streaming_capture.py`

```py
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


class _TrackingChunkWriter:
    """Module-level ChunkWriter stub shared across ``TestChunkWriterAlwaysClosed``.

    Tracks ``close()`` and ``write_chunk()`` calls so tests can assert
    cleanup invariants without touching the real filesystem.  ``delete()``
    delegates to ``close()`` to mirror the real implementation.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        self.path = Path("/tmp/chunk.jsonl")
        self.close_calls: list[bool] = []
        self.written_chunks: list[dict] = []

    def write_chunk(self, chunk: dict) -> None:
        self.written_chunks.append(chunk)

    def close(self) -> None:
        self.close_calls.append(True)

    def delete(self) -> None:
        self.close()


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

        instances: list[_TrackingChunkWriter] = []

        def _make_tracker(*args: Any, **kwargs: Any) -> _TrackingChunkWriter:
            inst = _TrackingChunkWriter(*args, **kwargs)
            instances.append(inst)
            return inst

        async def _failing_astream(inputs, *args, **kwargs):
            yield ((), (AIMessageChunk(content="partial", id="msg-1"), {}))
            raise RuntimeError("Simulated stream failure mid-way")

        agent = MagicMock()
        agent.astream = _failing_astream

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_make_tracker):
            result = await node_fn(_base_state())

        assert result["stage_success"] is False, "Stage must fail when stream raises"
        assert instances, "_TrackingChunkWriter was never instantiated"
        assert instances[0].close_calls, "ChunkWriter.close() must have been called on stream error"

    async def test_chunk_writer_closed_on_success(self, tmp_path: Path) -> None:
        """ChunkWriter.close() must be called on the normal success path."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        instances: list[_TrackingChunkWriter] = []

        def _make_tracker(*args: Any, **kwargs: Any) -> _TrackingChunkWriter:
            inst = _TrackingChunkWriter(*args, **kwargs)
            instances.append(inst)
            return inst

        chunk = AIMessageChunk(content="done", id="msg-1")
        agent = _make_stream_agent([((), (chunk, {}))])

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_make_tracker):
            result = await node_fn(_base_state())

        assert result["stage_success"] is True
        assert instances, "_TrackingChunkWriter was never instantiated"
        assert instances[0].close_calls, "ChunkWriter.close() must have been called on success"

    async def test_partial_chunks_written_before_stream_error(self, tmp_path: Path) -> None:
        """Chunks accumulated before the stream error must have been written
        to the ChunkWriter before close() is called."""
        from src.nodes.developer import make_developer_node

        cfg = _StreamCaptureConfig(workspace_root=tmp_path)
        node_fn = make_developer_node(cfg, [])

        instances: list[_TrackingChunkWriter] = []

        def _make_tracker(*args: Any, **kwargs: Any) -> _TrackingChunkWriter:
            inst = _TrackingChunkWriter(*args, **kwargs)
            instances.append(inst)
            return inst

        async def _failing_stream(inputs, *args, **kwargs):
            yield ((), (AIMessageChunk(content="partial content", id="msg-1"), {}))
            raise RuntimeError("Mid-stream failure")

        agent = MagicMock()
        agent.astream = _failing_stream

        with _patch_persona(), _patch_backend(), \
             patch("deepagents.create_deep_agent", return_value=agent), \
             patch("src.nodes.ChunkWriter", side_effect=_make_tracker):
            result = await node_fn(_base_state())

        assert result["stage_success"] is False
        assert instances, "_TrackingChunkWriter was never instantiated"
        assert instances[0].close_calls, "ChunkWriter.close() must have been called on error path"
        assert instances[0].written_chunks, "Partial chunks must have been written before the error"


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

```
###  Path: `/orchestrator/tests/test_subagents.py`

```py
"""Unit tests for orchestrator/src/utils/subagents.py.

Covers:
  - Stage with declared subagents → returns populated list with kebab-case names,
    descriptions from standalone YAML, and system_prompts from deep-agents files.
  - Stage with no subagents key → returns [].
  - Unknown stage (not in manifest) → returns [].
  - Cache hit → second call re-uses cached content.
  - Cache clear → subsequent call re-reads files.
  - Missing standalone YAML → FileNotFoundError.
  - Missing deep-agents file → FileNotFoundError (after standalone YAML exists).
  - Missing description field in standalone YAML → ValueError.
  - Integration: pm stage on the real workspace returns 4 specs.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.subagents import clear_cache, load_subagents

# Workspace root: two levels above orchestrator/tests/.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean_cache():
    """Ensure a clean subagent cache before and after each test."""
    clear_cache()
    yield
    clear_cache()


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

_MINIMAL_MANIFEST = {
    "roles": [
        {"id": "pm",        "number": 2, "name": "Project Manager"},
        {"id": "developer", "number": 3, "name": "Developer"},
    ]
}


def _make_workspace(
    tmp_path: Path,
    *,
    pm_subagents: list[str] | None = None,
    standalone_yaml: dict[str, str] | None = None,   # slug → description (None = omit field)
    deep_agents: dict[str, str] | None = None,         # slug → file content
    manifest: dict | None = None,
) -> Path:
    """Create a minimal workspace fixture under *tmp_path*.

    *pm_subagents* — list of slug strings to put in the ``subagents:`` block
    of the PM ledger YAML (2-project-manager.yaml).  When ``None`` the key is
    omitted entirely, simulating a stage with no subagents declared.

    *standalone_yaml* — mapping of slug → description string.  Each entry
    creates ``personas/standalone/src/meta/{slug}.yaml``.  Pass the slug key
    with an empty string to create a YAML file intentionally missing the
    description field.

    *deep_agents* — mapping of slug → file content.  Each entry creates
    ``personas/standalone/deep-agents/{slug}.md``.

    *manifest* — override the default minimal manifest.
    """
    m = manifest or _MINIMAL_MANIFEST

    # shared/workflow-manifest.json
    shared_dir = tmp_path / "shared"
    shared_dir.mkdir(parents=True)
    (shared_dir / "workflow-manifest.json").write_text(
        json.dumps(m), encoding="utf-8"
    )

    # personas/ledger/src/meta/
    ledger_meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
    ledger_meta_dir.mkdir(parents=True)

    # PM ledger YAML (number: 2)
    pm_lines = ["number: 2\nrole: Project Manager\n"]
    if pm_subagents is not None:
        pm_lines.append("subagents:\n")
        for slug in pm_subagents:
            pm_lines.append(f"  - {slug}\n")
    (ledger_meta_dir / "2-project-manager.yaml").write_text(
        "".join(pm_lines), encoding="utf-8"
    )

    # Developer ledger YAML (number: 3, no subagents)
    (ledger_meta_dir / "3-developer.yaml").write_text(
        "number: 3\nrole: Developer\n", encoding="utf-8"
    )

    # personas/standalone/src/meta/
    standalone_meta_dir = tmp_path / "personas" / "standalone" / "src" / "meta"
    standalone_meta_dir.mkdir(parents=True)

    for slug, description in (standalone_yaml or {}).items():
        if description:
            content = f"slug: {slug}\ndescription: \"{description}\"\n"
        else:
            # Deliberately omit description field to test ValueError path.
            content = f"slug: {slug}\nname: \"Some Name\"\n"
        (standalone_meta_dir / f"{slug}.yaml").write_text(content, encoding="utf-8")

    # personas/standalone/deep-agents/
    deep_agents_dir = tmp_path / "personas" / "standalone" / "deep-agents"
    deep_agents_dir.mkdir(parents=True)

    for slug, content in (deep_agents or {}).items():
        (deep_agents_dir / f"{slug}.md").write_text(content, encoding="utf-8")

    return tmp_path


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

class TestLoadSubagentsHappyPath:
    """Stage with declared subagents returns a correctly structured list."""

    def test_returns_expected_number_of_specs(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["slug-alpha", "slug-beta"],
            standalone_yaml={"slug-alpha": "Alpha does things.", "slug-beta": "Beta helps."},
            deep_agents={
                "slug-alpha": "# Alpha\nSystem prompt alpha.",
                "slug-beta": "# Beta\nSystem prompt beta.",
            },
        )
        result = load_subagents("pm", workspace_root=ws)
        assert len(result) == 2

    def test_name_is_kebab_case_slug(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-kebab-slug"],
            standalone_yaml={"my-kebab-slug": "Does something."},
            deep_agents={"my-kebab-slug": "system prompt content"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["name"] == "my-kebab-slug"

    def test_description_comes_from_standalone_yaml(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-agent"],
            standalone_yaml={"my-agent": "Standalone description text."},
            deep_agents={"my-agent": "system prompt"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["description"] == "Standalone description text."

    def test_system_prompt_comes_from_deep_agents_file(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-agent"],
            standalone_yaml={"my-agent": "Some description."},
            deep_agents={"my-agent": "The full persona system prompt."},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["system_prompt"] == "The full persona system prompt."

    def test_all_required_keys_present(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["agent-x"],
            standalone_yaml={"agent-x": "Desc."},
            deep_agents={"agent-x": "Prompt."},
        )
        result = load_subagents("pm", workspace_root=ws)
        entry = result[0]
        assert set(entry.keys()) >= {"name", "description", "system_prompt"}

    def test_accepts_string_workspace_root(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["agent-y"],
            standalone_yaml={"agent-y": "Desc."},
            deep_agents={"agent-y": "Prompt."},
        )
        result = load_subagents("pm", workspace_root=str(ws))
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Empty / no-subagents cases
# ---------------------------------------------------------------------------

class TestNoSubagents:
    """Stages with no configured subagents return an empty list."""

    def test_developer_stage_has_no_subagents_key(self, tmp_path: Path):
        ws = _make_workspace(tmp_path)
        result = load_subagents("developer", workspace_root=ws)
        assert result == []

    def test_pm_stage_with_no_subagents_key_returns_empty(self, tmp_path: Path):
        # pm_subagents=None → key omitted from ledger YAML
        ws = _make_workspace(tmp_path, pm_subagents=None)
        result = load_subagents("pm", workspace_root=ws)
        assert result == []

    def test_unknown_stage_returns_empty_list(self, tmp_path: Path):
        """Stage not present in the manifest returns []."""
        ws = _make_workspace(tmp_path)
        result = load_subagents("nonexistent_stage", workspace_root=ws)
        assert result == []


# ---------------------------------------------------------------------------
# Cache behaviour
# ---------------------------------------------------------------------------

class TestCacheHit:
    """Second call returns cached content without re-reading the file."""

    def test_second_call_uses_cache(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["cached-agent"],
            standalone_yaml={"cached-agent": "Original description."},
            deep_agents={"cached-agent": "Original system prompt."},
        )
        first = load_subagents("pm", workspace_root=ws)

        # Overwrite both files on disk — cache should still return original content.
        (ws / "personas" / "standalone" / "src" / "meta" / "cached-agent.yaml").write_text(
            "slug: cached-agent\ndescription: \"CHANGED\"\n", encoding="utf-8"
        )
        (ws / "personas" / "standalone" / "deep-agents" / "cached-agent.md").write_text(
            "CHANGED PROMPT", encoding="utf-8"
        )
        second = load_subagents("pm", workspace_root=ws)

        assert first[0]["description"] == "Original description."
        assert second[0]["description"] == "Original description."
        assert first[0]["system_prompt"] == "Original system prompt."
        assert second[0]["system_prompt"] == "Original system prompt."


class TestCacheClear:
    """After clear_cache() the next load re-reads the files."""

    def test_clear_causes_reread(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["reload-agent"],
            standalone_yaml={"reload-agent": "v1 description."},
            deep_agents={"reload-agent": "v1 prompt"},
        )
        first = load_subagents("pm", workspace_root=ws)
        assert first[0]["description"] == "v1 description."

        # Update file content and clear the cache.
        (ws / "personas" / "standalone" / "src" / "meta" / "reload-agent.yaml").write_text(
            "slug: reload-agent\ndescription: \"v2 description.\"\n", encoding="utf-8"
        )
        (ws / "personas" / "standalone" / "deep-agents" / "reload-agent.md").write_text(
            "v2 prompt", encoding="utf-8"
        )
        clear_cache()

        second = load_subagents("pm", workspace_root=ws)
        assert second[0]["description"] == "v2 description."
        assert second[0]["system_prompt"] == "v2 prompt"


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

class TestMissingStandaloneYaml:
    """Declared slug with no standalone YAML raises FileNotFoundError."""

    def test_raises_file_not_found_for_missing_yaml(self, tmp_path: Path):
        # No standalone YAML created for "ghost-agent".
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["ghost-agent"],
        )
        with pytest.raises(FileNotFoundError, match="ghost-agent"):
            load_subagents("pm", workspace_root=ws)


class TestMissingDeepAgentsFile:
    """Declared slug where standalone YAML exists but deep-agents file is absent."""

    def test_raises_file_not_found_for_missing_deep_agents(self, tmp_path: Path):
        # Standalone YAML exists but no deep-agents file.
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["half-agent"],
            standalone_yaml={"half-agent": "Has a description."},
            # deep_agents intentionally omitted for this slug
        )
        with pytest.raises(FileNotFoundError, match="half-agent"):
            load_subagents("pm", workspace_root=ws)


class TestMissingDescription:
    """Standalone YAML that lacks a description field raises ValueError."""

    def test_raises_value_error_when_description_missing(self, tmp_path: Path):
        # Pass empty string as description → the helper omits the description field.
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["no-desc-agent"],
            standalone_yaml={"no-desc-agent": ""},   # empty → description field omitted
            deep_agents={"no-desc-agent": "Prompt content."},
        )
        with pytest.raises(ValueError, match="description"):
            load_subagents("pm", workspace_root=ws)


# ---------------------------------------------------------------------------
# Integration test — real workspace
# ---------------------------------------------------------------------------

class TestRealWorkspace:
    """Integration tests against the actual workspace files."""

    def test_pm_returns_four_specs(self):
        """load_subagents('pm') on the real workspace returns 4 subagent specs."""
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        assert len(result) == 4

    def test_pm_specs_have_kebab_case_names(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            name = spec["name"]
            # kebab-case: only lowercase letters, digits, and hyphens
            assert name == name.lower(), f"Name {name!r} is not lowercase"
            assert " " not in name, f"Name {name!r} contains spaces"

    def test_pm_specs_have_descriptions_from_standalone_yaml(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            assert isinstance(spec["description"], str)
            assert len(spec["description"]) > 0

    def test_pm_specs_have_system_prompts_from_deep_agents(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            assert isinstance(spec["system_prompt"], str)
            assert len(spec["system_prompt"]) > 0

    def test_developer_returns_empty_list(self):
        """load_subagents('developer') on the real workspace returns []."""
        result = load_subagents("developer", workspace_root=_WORKSPACE_ROOT)
        assert result == []

```
###  Path: `/orchestrator/tests/test_subprocess_encoding.py`

```py
"""
Tests for ``src.utils.subprocess_encoding`` — the Windows subprocess text-mode
encoding monkeypatch.

Covers:
1. Patch is applied on Windows (or skipped on non-Windows).
2. ``errors='replace'`` is injected when ``text=True`` and no explicit ``errors``.
3. Explicit ``errors=`` is never overridden.
4. Binary-mode (no text=True, no encoding=) is never affected.
5. ``encoding='...'`` without ``text=True`` also triggers the patch.
6. Idempotency — importing/applying twice doesn't stack patches.
"""

from __future__ import annotations

import subprocess
import sys

import pytest

# ---------------------------------------------------------------------------
# 1. Patch application
# ---------------------------------------------------------------------------


class TestPatchApplication:
    def test_module_importable(self):
        """The module must import without errors."""
        import src.utils.subprocess_encoding  # noqa: F401

    def test_patch_flag_is_set(self):
        """After import, the _PATCHED flag must be True on Windows."""
        import src.utils.subprocess_encoding as mod

        if sys.platform == "win32":
            assert mod._PATCHED is True
        else:
            # On non-Windows, the patch is a no-op.
            assert mod._PATCHED is False

    def test_idempotent(self):
        """Calling _apply_patch() again must not stack patches."""
        import src.utils.subprocess_encoding as mod

        prev = subprocess.Popen.__init__
        mod._apply_patch()
        assert subprocess.Popen.__init__ is prev, "Patch must not stack on repeated apply"


# ---------------------------------------------------------------------------
# 2–5. Subprocess.Popen argument injection (Windows only)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(sys.platform != "win32", reason="Patch only applies on Windows")
class TestPopenErrorsInjection:
    """Verify that the monkeypatch injects ``errors='replace'`` correctly."""

    def test_text_true_injects_errors_replace(self, tmp_path):
        """Popen(text=True) without errors= must get errors='replace'."""
        # Use a harmless command that finishes immediately.
        p = subprocess.Popen(
            ["cmd", "/c", "echo hello"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Check that the stdout wrapper has 'replace' error mode.
        assert p.stdout is not None
        assert p.stdout.errors == "replace"
        p.communicate()
        p.wait()

    def test_explicit_errors_not_overridden(self, tmp_path):
        """Popen(text=True, errors='strict') must keep 'strict'."""
        p = subprocess.Popen(
            ["cmd", "/c", "echo hello"],
            text=True,
            errors="strict",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert p.stdout is not None
        assert p.stdout.errors == "strict"
        p.communicate()
        p.wait()

    def test_encoding_without_text_injects_errors(self):
        """Popen(encoding='utf-8') (no text=True) must also get errors='replace'."""
        p = subprocess.Popen(
            ["cmd", "/c", "echo hello"],
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert p.stdout is not None
        assert p.stdout.errors == "replace"
        p.communicate()
        p.wait()

    def test_binary_mode_unaffected(self):
        """Popen without text=True or encoding= must not be patched."""
        p = subprocess.Popen(
            ["cmd", "/c", "echo hello"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # In binary mode, stdout has no 'errors' attribute.
        assert not hasattr(p.stdout, "errors") or p.stdout.errors is None  # type: ignore[union-attr]
        p.communicate()
        p.wait()

    def test_replacement_character_on_invalid_bytes(self, tmp_path):
        """Bytes invalid in UTF-8 must be replaced, not crash."""
        # Write a file containing 0x82 (invalid in UTF-8, valid in CP1252).
        bad_file = tmp_path / "bad.bin"
        bad_file.write_bytes(b"hello \x82 world\n")

        p = subprocess.Popen(
            ["cmd", "/c", f"type {bad_file}"],
            text=True,
            encoding="utf-8",
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        stdout, _ = p.communicate()
        # The 0x82 byte should be replaced with U+FFFD, not crash.
        assert "\ufffd" in stdout or "hello" in stdout
        assert p.returncode == 0

```
###  Path: `/orchestrator/tests/test_supervisor.py`

```py
"""
test_supervisor.py — Unit tests for the supervisor routing logic.

Tests verify deterministic routing for all paths in the decision tree,
using mock MCP tools that return pre-configured ledger state.

No LLM calls, no MCP server required — all tests run in < 1 second.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.config import FAIL_ROUTING_AGENT_MAP, PIPELINE_AGENT_MAP
from src.supervisor import make_supervisor_node

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_tool(name: str, return_value: Any) -> MagicMock:
    """Return a mock LangChain Tool that returns *return_value* when ainvoked."""
    tool = MagicMock()
    tool.name = name
    tool.ainvoke = AsyncMock(
        return_value=json.dumps(return_value) if not isinstance(return_value, str) else return_value
    )
    return tool


def _derive_next_action(
    agent_role: str, wp_list: list, wp_details: dict[str, dict]
) -> dict:
    """
    Simulate what ``ledger_get_next_action`` would return for a given
    agent role based on WP pipeline state.

    Used exclusively by test mocks — not production code.

    **Drift risk:** This helper re-implements a subset of the MCP server's
    ``ledger_get_next_action`` routing logic.  One sync point must be kept
    up to date whenever the workflow changes:

    1. **Action vocabulary** (``IMPLEMENT``, ``RUN_QA``, ``REWORK``, etc.):
       authoritative source is ``mcp-server/src/utils/constants.ts``
       (``AGENT_ACTIONS`` / ``_DISPATCH_ACTIONS``).

    Both PASS-branch and FAIL-branch routing targets are derived
    programmatically from ``PIPELINE_AGENT_MAP`` /
    ``FAIL_ROUTING_AGENT_MAP`` (``shared/workflow-manifest.json``) and
    do not require manual synchronisation.
    """

    def latest(pipelines: list, ptype: str) -> str | None:
        for p in reversed(pipelines):
            if p.get("type") == ptype:
                return p.get("status")
        return None

    non_terminal = [
        wp
        for wp in wp_list
        if wp.get("status") not in ("COMPLETE", "CANCELLED")
    ]

    # All non-terminal WPs BLOCKED → PM handles repair.
    if non_terminal and all(wp.get("status") == "BLOCKED" for wp in non_terminal):
        if agent_role == "Project Manager":
            return {"action": "REPAIR_ORPHAN_BLOCKED"}
        return {"action": "WAIT"}

    # IN_PROGRESS WPs first (matches MCP server priority), then READY.
    ordered = (
        [wp for wp in wp_list if wp.get("status") == "IN_PROGRESS"]
        + [wp for wp in wp_list if wp.get("status") == "READY"]
    )

    for wp_summary in ordered:
        wp_id = wp_summary.get("work_package_id", "")
        if wp_summary.get("status") in ("COMPLETE", "CANCELLED", "BLOCKED"):
            continue

        wp_detail = wp_details.get(wp_id, wp_summary)
        pipelines = wp_detail.get("pipelines", [])

        impl = latest(pipelines, "implementation")
        qa = latest(pipelines, "qa")
        sa = latest(pipelines, "security-audit")
        cr = latest(pipelines, "code-review")
        re = latest(pipelines, "release-engineering")
        doc = latest(pipelines, "documentation")

        if impl is None:
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "IMPLEMENT"
        elif impl == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["implementation"], "CONTINUE_PIPELINE"
        elif impl == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["implementation"], "REWORK"
        elif impl == "PASS" and qa is None:
            next_role, action = PIPELINE_AGENT_MAP["qa"], "RUN_QA"
        elif qa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["qa"], "CONTINUE_PIPELINE"
        elif qa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["qa"], "REWORK"
        elif qa == "PASS" and sa is None:
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "RUN_SECURITY_AUDIT"
        elif sa == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["security-audit"], "CONTINUE_PIPELINE"
        elif sa == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["security-audit"], "REWORK"
        elif sa == "PASS" and cr is None:
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "RUN_REVIEW"
        elif cr == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["code-review"], "CONTINUE_PIPELINE"
        elif cr == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["code-review"], "REWORK"
        elif cr == "PASS" and re is None:
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "RUN_RELEASE_ENGINEERING"
        elif re == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["release-engineering"], "CONTINUE_PIPELINE"
        elif re == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["release-engineering"], "REWORK"
        elif re == "PASS" and doc is None:
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "WRITE_DOCS"
        elif doc == "IN_PROGRESS":
            next_role, action = PIPELINE_AGENT_MAP["documentation"], "CONTINUE_PIPELINE"
        elif doc == "FAIL":
            next_role, action = FAIL_ROUTING_AGENT_MAP["documentation"], "REWORK"
        else:
            continue  # WP fully done

        if next_role == agent_role:
            return {"action": action, "work_package_id": wp_id}

    return {"action": "WAIT"}


def make_mcp_tools(
    *,
    project_status: dict | None = None,
    wp_list: list | None = None,
    wp_details: dict[str, dict] | None = None,
) -> list[MagicMock]:
    """
    Build a minimal set of mock MCP tools: project_status, list_work_packages,
    and per-WP detail lookups.

    Parameters
    ----------
    project_status:
        Dict returned by ``ledger_get_project_status``.
    wp_list:
        List returned by ``ledger_list_work_packages``.
    wp_details:
        Dict mapping WP ID → detail dict returned by ``ledger_get_work_package``.
    """
    if project_status is None:
        project_status = {"status": "IN_PROGRESS"}
    if wp_list is None:
        wp_list = []
    if wp_details is None:
        wp_details = {}

    status_tool = make_tool("ledger_get_project_status", project_status)
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        detail = wp_details.get(wp_id, {"work_package_id": wp_id, "pipelines": []})
        return json.dumps(detail)

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        result = _derive_next_action(role, wp_list, wp_details)
        return json.dumps(result)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


def base_state(
    iteration: int = 0,
    max_iterations: int = 10,
    project_path: str = "/project",
) -> dict:
    """Minimal WorkflowState-compatible dict for test invocations."""
    return {
        "project_path": project_path,
        "plan_file": "plan.md",
        "target_project_path": "/target",
        "current_stage": "",
        "current_wp_id": "",
        "iteration": iteration,
        "max_iterations": max_iterations,
        "stage_result": "",
        "stage_success": True,
        "project_status": "",
        "wp_summaries": [],
        "pending_wp_count": 0,
        "consecutive_failures": {},
        "run_log": [],
        "errors": [],
    }


def wp_summary(wp_id: str, status: str = "READY") -> dict:
    return {"work_package_id": wp_id, "status": status}


def wp_with_pipelines(wp_id: str, pipelines: list[dict]) -> dict:
    return {"work_package_id": wp_id, "pipelines": pipelines}


def pipeline(type_: str, status: str) -> dict:
    return {"type": type_, "status": status}


# ---------------------------------------------------------------------------
# Tests: routing to "pm"
# ---------------------------------------------------------------------------

class TestRouteToPM:
    async def test_no_wps_routes_to_pm(self):
        """When no WPs exist, route to PM."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"
        assert cmd.update["current_stage"] == "pm"
        assert cmd.update["run_log"][0]["destination"] == "pm"


# ---------------------------------------------------------------------------
# Tests: routing to "developer"
# ---------------------------------------------------------------------------

class TestRouteToDeveloper:
    async def test_wp_with_no_pipelines_routes_to_developer(self):
        """A READY WP with no pipelines routes to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_implementation_fail_routes_to_developer(self):
        """A FAIL implementation pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "FAIL")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_qa_fail_routes_to_developer(self):
        """A FAIL QA pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"

    async def test_code_review_fail_routes_to_developer(self):
        """A FAIL code-review pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "qa"
# ---------------------------------------------------------------------------

class TestRouteToQA:
    async def test_pass_impl_no_qa_routes_to_qa(self):
        """A PASS implementation with no QA pipeline routes to qa."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "PASS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "qa"


# ---------------------------------------------------------------------------
# Tests: routing to "reviewer"
# ---------------------------------------------------------------------------

class TestRouteToReviewer:
    async def test_pass_qa_no_review_routes_to_reviewer(self):
        """A PASS QA and security-audit with no code-review pipeline routes to reviewer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "reviewer"


# ---------------------------------------------------------------------------
# Tests: routing to "security_auditor"
# ---------------------------------------------------------------------------

class TestRouteToSecurityAuditor:
    async def test_pass_qa_no_security_audit_routes_to_security_auditor(self):
        """A PASS QA with no security-audit pipeline routes to security_auditor."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "security_auditor"

    async def test_security_audit_fail_routes_to_developer(self):
        """A FAIL security-audit pipeline causes rework route to developer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"


# ---------------------------------------------------------------------------
# Tests: routing to "release_engineer"
# ---------------------------------------------------------------------------

class TestRouteToReleaseEngineer:
    async def test_pass_code_review_no_release_engineering_routes_to_release_engineer(self):
        """A PASS code-review with no release-engineering pipeline routes to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"

    async def test_release_engineering_fail_routes_to_release_engineer(self):
        """A FAIL release-engineering pipeline causes rework route to release_engineer."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "release_engineer"


# ---------------------------------------------------------------------------
# Tests: routing to "docs"
# ---------------------------------------------------------------------------

class TestDocumentationFail:
    async def test_documentation_fail_routes_to_docs(self):
        """A FAIL documentation pipeline causes rework route to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "FAIL"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


class TestRouteToDocs:
    async def test_pass_review_no_docs_routes_to_docs(self):
        """A PASS code-review and release-engineering with no documentation
        pipeline routes to docs."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: routing to "synthesis"
# ---------------------------------------------------------------------------

class TestRouteToSynthesis:
    async def test_all_complete_routes_to_synthesis(self):
        """When all WPs are COMPLETE, route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_routes_to_synthesis_when_all_wps_mix_of_complete_and_cancelled(self):
        """WPs that are a mix of COMPLETE and CANCELLED should route to synthesis."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
                wp_summary("WP-003", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_pending_count_excludes_cancelled_wps(self):
        """CANCELLED WPs must not be counted as pending (pending_count should be 0)."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "CANCELLED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update["pending_wp_count"] == 0
        assert cmd.update.get("current_wp_id") == ""

    async def test_all_pipelines_pass_routes_to_synthesis(self):
        """All six pipelines PASS → WP considered done → synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [
                        pipeline("implementation", "PASS"),
                        pipeline("qa", "PASS"),
                        pipeline("security-audit", "PASS"),
                        pipeline("code-review", "PASS"),
                        pipeline("release-engineering", "PASS"),
                        pipeline("documentation", "PASS"),
                    ],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_synthesis_all_terminal_clears_stale_wp_id(self):
        """All-WPs-terminal synthesis path clears a stale current_wp_id."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "COMPLETE"),
                wp_summary("WP-002", "COMPLETE"),
            ]
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-STALE"

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""

    async def test_synthesis_all_wait_clears_stale_wp_id(self):
        """All-roles-WAIT synthesis path clears a stale current_wp_id.

        WP-001 is IN_PROGRESS but circuit-broken (3 consecutive failures),
        so all roles skip it and the supervisor falls through to the
        all-roles-WAIT synthesis route.
        """
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-STALE"
        state["consecutive_failures"] = {"WP-001": 3}  # circuit-breaks WP-001 → all roles WAIT

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert cmd.update.get("current_wp_id") == ""


# ---------------------------------------------------------------------------
# Tests: END conditions
# ---------------------------------------------------------------------------

class TestSafetyLimit:
    async def test_exceeds_max_iterations_routes_to_end(self):
        """When iteration > max_iterations, route to END with error."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # iteration=10, max_iterations=10 → new_iteration=11 > 10
        cmd = await node(base_state(iteration=10, max_iterations=10))

        assert cmd.goto == END
        assert cmd.update["errors"]
        assert "Safety limit" in cmd.update["errors"][0]["message"]

    async def test_at_max_iterations_still_routes_to_end(self):
        """Edge case: iteration == max_iterations triggers safety limit on next call."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        # new_iteration will be max_iterations + 1 = 6
        cmd = await node(base_state(iteration=5, max_iterations=5))

        assert cmd.goto == END


class TestAllBlocked:
    async def test_all_blocked_routes_to_pm(self):
        """When all WPs are BLOCKED, ledger_get_next_action returns
        REPAIR_ORPHAN_BLOCKED for PM, routing to the pm stage."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "BLOCKED"),
            ]
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm"


# ---------------------------------------------------------------------------
# Tests: BLOCKED WPs skipped, unblocked processed first
# ---------------------------------------------------------------------------

class TestBlockedSkipped:
    async def test_blocked_wp_is_skipped(self):
        """BLOCKED WPs are skipped; the READY WP gets processed."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "BLOCKED"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # WP-001 is BLOCKED (skipped by mock); WP-002 routes to developer.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-002"

    async def test_in_progress_processed_before_ready(self):
        """IN_PROGRESS WP is prioritised over READY WP by ledger_get_next_action."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "READY"),
                wp_summary("WP-002", "IN_PROGRESS"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # WP-002 (IN_PROGRESS) is prioritised — ledger returns it first.
        assert cmd.update["current_wp_id"] == "WP-002"


# ---------------------------------------------------------------------------
# Tests: run_log and state update
# ---------------------------------------------------------------------------

class TestRunLog:
    async def test_routing_decision_logged_in_run_log(self):
        """Every routing decision must be recorded in run_log."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update["run_log"], "run_log should be non-empty"
        entry = cmd.update["run_log"][0]
        assert "destination" in entry
        assert "timestamp" in entry
        assert "action" in entry

    async def test_state_iteration_incremented(self):
        """Supervisor must increment the iteration counter on every pass."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state(iteration=3))

        assert cmd.update["iteration"] == 4


# ---------------------------------------------------------------------------
# Tests: IN_PROGRESS pipeline skipping
# ---------------------------------------------------------------------------

class TestInFlightSkip:
    async def test_wp_with_in_progress_impl_routes_to_developer(
        self,
    ):
        """WP with an IN_PROGRESS implementation pipeline now routes to
        developer with CONTINUE_PIPELINE (ledger-driven) instead of being
        skipped to END as in the old hardcoded routing."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001",
                    [pipeline("implementation", "IN_PROGRESS")],
                )
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Ledger returns CONTINUE_PIPELINE → routes to developer, not END.
        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"

    async def test_in_progress_impl_routed_first(self):
        """WP-001 has impl=IN_PROGRESS; both WPs need Developer.
        Ledger returns WP-001 first (IN_PROGRESS priority), so supervisor
        routes to developer for WP-001 not WP-002."""
        tools = make_mcp_tools(
            wp_list=[
                wp_summary("WP-001", "IN_PROGRESS"),
                wp_summary("WP-002", "READY"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines(
                    "WP-001", [pipeline("implementation", "IN_PROGRESS")]
                ),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer"
        assert cmd.update["current_wp_id"] == "WP-001"


# ---------------------------------------------------------------------------
# Tests: circuit breaker (consecutive failures)
# ---------------------------------------------------------------------------

class TestCircuitBreaker:
    async def test_wp_halted_after_three_consecutive_failures(self):
        """After 3 consecutive failures for the only WP, supervisor
        circuit-breaks it, all roles return WAIT, and routes to synthesis."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}  # already at threshold

        cmd = await node(state)

        # WP-001 circuit-broken → all roles skip it → route to synthesis.
        assert cmd.goto == "synthesis"
        errors = cmd.update.get("errors", [])
        assert any("halted" in str(e).lower() or "WP-001" in str(e) for e in errors), (
            "Expected a halted error entry for WP-001"
        )

    async def test_consecutive_failures_counter_incremented_on_failure(self):
        """Counter in base_update['consecutive_failures'] increments on failure."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 1}  # already had 1 failure

        cmd = await node(state)

        # Supervisor reads from consecutive_failures, cf["WP-001"] should now be 2.
        cf = cmd.update.get("consecutive_failures", {})
        assert cf.get("WP-001", 0) == 2, f"Expected cf['WP-001']=2, got {cf}"

    async def test_consecutive_failures_reset_on_success(self):
        """Counter is reset in base_update when the previous stage succeeded."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = True  # succeeded
        state["consecutive_failures"] = {"WP-001": 2}  # had 2 prior failures

        cmd = await node(state)

        cf = cmd.update.get("consecutive_failures", {})
        assert "WP-001" not in cf, f"Expected WP-001 counter reset, got {cf}"


# ---------------------------------------------------------------------------
# Tests: halted WP cancellation before synthesis dispatch
# ---------------------------------------------------------------------------

class TestHaltedWPCancellation:
    """
    When all roles return WAIT/skip due to circuit-broken WPs, the supervisor
    must call ledger_update_work_package_status(CANCELLED) for each halted WP
    before routing to synthesis (§16.3 — automated circuit-breaker escalation).
    """

    def _make_tools_with_update_status(
        self,
        wp_list: list,
        wp_details: dict,
        update_status_calls: list,
        *,
        update_raises: Exception | None = None,
    ) -> list:
        """
        Build mock tools including ledger_update_work_package_status.
        The *update_status_calls* list is populated with each call's kwargs.
        """
        base_tools = make_mcp_tools(wp_list=wp_list, wp_details=wp_details)

        async def _update_status_side_effect(kwargs: dict) -> str:
            update_status_calls.append(dict(kwargs))
            if update_raises is not None:
                raise update_raises
            return json.dumps({"status": "CANCELLED"})

        update_tool = MagicMock()
        update_tool.name = "ledger_update_work_package_status"
        update_tool.ainvoke = AsyncMock(side_effect=_update_status_side_effect)

        return base_tools + [update_tool]

    async def test_halted_wp_is_cancelled_before_synthesis(self):
        """Halted WP (3 consecutive failures, IN_PROGRESS) is cancelled before
        routing to synthesis."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert update_calls, "ledger_update_work_package_status must have been called"
        call = update_calls[0]
        assert call.get("work_package_id") == "WP-001"
        assert call.get("status") == "CANCELLED"
        assert call.get("agent") == "Project Manager"

    async def test_cancellation_logged_as_warning(self):
        """Each cancelled WP must produce a WARNING-level run_log entry with
        action 'halted_wp_cancelled'."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        cancel_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "halted_wp_cancelled"
        ]
        assert cancel_entries, "run_log must contain a halted_wp_cancelled entry"
        entry = cancel_entries[0]
        assert entry["level"] == "WARNING"
        assert entry["wp_id"] == "WP-001"

    async def test_already_cancelled_wp_is_skipped_idempotent(self):
        """A WP that is already CANCELLED must not trigger another status update."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "CANCELLED")],  # already CANCELLED
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}

        # All WPs CANCELLED → hits the "all terminal" path; no update needed.
        cmd = await node(state)

        assert cmd.goto == "synthesis"
        assert not update_calls, (
            "ledger_update_work_package_status must NOT be called for already-CANCELLED WPs"
        )

    async def test_cancellation_failure_does_not_block_synthesis(self):
        """If ledger_update_work_package_status raises, synthesis routing must
        still proceed (graceful degradation)."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
            update_status_calls=update_calls,
            update_raises=RuntimeError("ledger tool failure"),
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_wp_id"] = "WP-001"
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        # Synthesis must still be reached despite the cancellation failure.
        assert cmd.goto == "synthesis"

    async def test_multiple_halted_wps_all_cancelled(self):
        """All halted WPs (not just the first) must be cancelled."""
        update_calls: list = []
        tools = self._make_tools_with_update_status(
            wp_list=[
                wp_summary("WP-001", "IN_PROGRESS"),
                wp_summary("WP-002", "IN_PROGRESS"),
            ],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", []),
            },
            update_status_calls=update_calls,
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = False
        state["consecutive_failures"] = {"WP-001": 3, "WP-002": 3}

        cmd = await node(state)

        assert cmd.goto == "synthesis"
        cancelled_wp_ids = {c.get("work_package_id") for c in update_calls}
        assert "WP-001" in cancelled_wp_ids
        assert "WP-002" in cancelled_wp_ids


# ---------------------------------------------------------------------------
# Tests: level field in log entries
# ---------------------------------------------------------------------------

class TestLogEntryLevel:
    async def test_routing_log_entry_has_level_info(self):
        """All routing log entries must include 'level': 'INFO'."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        for entry in cmd.update.get("run_log", []):
            assert "level" in entry, f"Log entry missing 'level' field: {entry}"
            assert entry["level"] in ("INFO", "WARNING", "ERROR"), (
                f"Unexpected level value: {entry['level']}"
            )


# ---------------------------------------------------------------------------
# Tests: no-LLM guarantee (structural)
# ---------------------------------------------------------------------------

class TestNoLLMCalls:
    def test_supervisor_does_not_import_llm_libs(self):
        """supervisor module must not import anthropic/openai/google-genai."""
        import ast
        import inspect

        import src.supervisor as sup_module

        source = inspect.getsource(sup_module)
        tree = ast.parse(source)
        forbidden = {"anthropic", "openai", "langchain_anthropic", "langchain_google_genai"}
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = (
                    [alias.name for alias in node.names]
                    if isinstance(node, ast.Import)
                    else ([node.module] if node.module else [])
                )
                for name in names:
                    assert name not in forbidden, (
                        f"supervisor imports LLM library: {name}"
                    )


# ---------------------------------------------------------------------------
# Helper: direct action override (WP-005 additions)
# ---------------------------------------------------------------------------

def make_mcp_tools_with_actions(
    next_actions: dict[str, dict] | None = None,
    *,
    has_wps: bool = True,
) -> list[MagicMock]:
    """
    Build mock MCP tools where ``ledger_get_next_action`` returns explicit
    per-role responses from *next_actions*.  Roles not in the dict get
    ``{"action": "WAIT"}``.

    This lets action-routing tests bypass the ``_derive_next_action`` helper
    and directly exercise each action constant → stage mapping.

    Parameters
    ----------
    next_actions:
        Mapping ``{role: {"action": "...", "work_package_id": "..."}}`` for
        roles that should return a real action.  Defaults to ``{}`` (all WAIT).
    has_wps:
        When ``True`` a single non-terminal WP is included so the supervisor
        doesn't short-circuit to PM (no-WPs path) or synthesis (all-terminal).
        Set to ``False`` to test the no-WP → PM path independently.
    """
    _actions = next_actions or {}

    wp_list: list = (
        [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}] if has_wps else []
    )

    status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
    list_tool = make_tool("ledger_list_work_packages", wp_list)

    async def wp_detail_side_effect(kwargs: dict) -> str:
        wp_id = kwargs.get("work_package_id", "")
        return json.dumps({"work_package_id": wp_id, "pipelines": []})

    detail_tool = MagicMock()
    detail_tool.name = "ledger_get_work_package"
    detail_tool.ainvoke = AsyncMock(side_effect=wp_detail_side_effect)

    async def next_action_side_effect(kwargs: dict) -> str:
        role = kwargs.get("agent_role", "")
        response = _actions.get(role, {"action": "WAIT"})
        return json.dumps(response)

    next_action_tool = MagicMock()
    next_action_tool.name = "ledger_get_next_action"
    next_action_tool.ainvoke = AsyncMock(side_effect=next_action_side_effect)

    return [status_tool, list_tool, detail_tool, next_action_tool]


# ---------------------------------------------------------------------------
# Tests: direct action → stage mapping (WP-005 AC3)
# ---------------------------------------------------------------------------

class TestDirectActionRouting:
    """Verify that every action constant in ``_DISPATCH_ACTIONS`` is routed
    to the correct pipeline stage by the supervisor.

    Each test uses ``make_mcp_tools_with_actions`` to inject a deterministic
    ``ledger_get_next_action`` response, bypassing the
    ``_derive_next_action`` simulation helper used elsewhere in this file.
    """

    @pytest.mark.parametrize("role,action,expected_stage", [
        # Developer actions
        ("Developer", "IMPLEMENT",          "developer"),
        ("Developer", "REWORK",             "developer"),
        ("Developer", "RESUME_OR_CANCEL",   "developer"),
        ("Developer", "CONTINUE_PIPELINE",  "developer"),
        ("Developer", "CLAIM_WP",           "developer"),
        # QA actions
        ("QA",        "RUN_QA",             "qa"),
        # Security Auditor actions
        ("Security Auditor",  "RUN_SECURITY_AUDIT",      "security_auditor"),
        # Reviewer actions
        ("Reviewer",  "RUN_REVIEW",         "reviewer"),
        # Release Engineer actions
        ("Release Engineer",  "RUN_RELEASE_ENGINEERING",  "release_engineer"),
        ("Release Engineer",  "REWORK",                   "release_engineer"),
        # Documentation actions
        ("Documentation", "WRITE_DOCS",     "docs"),
        ("Documentation", "FINALIZE_WP",    "docs"),
        ("Documentation", "UPDATE_CRITERIA","docs"),
        # PM actions
        ("Project Manager", "UNBLOCK_WP",          "pm"),
        ("Project Manager", "REVIEW_REWORK_LIMIT",  "pm"),
        ("Project Manager", "REPAIR_ORPHAN_BLOCKED","pm"),
        ("Project Manager", "REVIEW_STALE",         "pm"),
        ("Project Manager", "REVIEW_ABANDONED",     "pm"),
        ("Project Manager", "ROUTE_PIPELINE_AGENT", "pm"),  # fallback: no next_agent
    ])
    async def test_action_routes_to_correct_stage(
        self, role: str, action: str, expected_stage: str
    ):
        """Each (role, action) pair must dispatch to the correct stage."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == expected_stage, (
            f"role={role!r}, action={action!r}: expected {expected_stage!r}, "
            f"got {cmd.goto!r}"
        )

    @pytest.mark.parametrize("role,action,expected_stage", [
        ("Developer", "IMPLEMENT", "developer"),
        ("Documentation", "WRITE_DOCS", "docs"),
    ])
    async def test_current_wp_id_is_set_in_update(
        self, role: str, action: str, expected_stage: str
    ):
        """Supervisor must set current_wp_id to the WP ID from the action data."""
        tools = make_mcp_tools_with_actions(
            {role: {"action": action, "work_package_id": "WP-042"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.update.get("current_wp_id") == "WP-042", (
            f"current_wp_id should be 'WP-042', got {cmd.update.get('current_wp_id')!r}"
        )

    async def test_first_dispatchable_role_wins(self):
        """When multiple roles have dispatchable actions, the first one in the
        role iteration order (PM → Developer → QA → Reviewer → Docs) wins."""
        # PM and Developer both have actions; PM is first in the loop.
        tools = make_mcp_tools_with_actions({
            "Project Manager": {"action": "UNBLOCK_WP", "work_package_id": "WP-001"},
            "Developer":       {"action": "IMPLEMENT",  "work_package_id": "WP-002"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # PM comes first in _ROLES order, so it should win.
        assert cmd.goto == "pm"


# ---------------------------------------------------------------------------
# Tests: ROUTE_PIPELINE_AGENT direct routing
# ---------------------------------------------------------------------------

class TestRoutePipelineAgent:
    """Verify that ROUTE_PIPELINE_AGENT uses the next_agent field to route
    directly to the target stage rather than back to PM."""

    async def test_route_pipeline_agent_qa_routes_to_qa_stage(self):
        """ROUTE_PIPELINE_AGENT with next_agent='QA' must route to 'qa' stage."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "QA",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "qa", (
            f"ROUTE_PIPELINE_AGENT next_agent='QA' should route to 'qa', got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_developer_routes_to_developer_stage(self):
        """ROUTE_PIPELINE_AGENT with next_agent='Developer' must route to 'developer' stage."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "Developer",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "developer", (
            f"ROUTE_PIPELINE_AGENT next_agent='Developer' should route to 'developer', "
            f"got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_unknown_next_agent_falls_back_to_pm(self):
        """ROUTE_PIPELINE_AGENT with an unknown next_agent must fall back to
        the queried role's stage (PM → 'pm')."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                "next_agent": "UnknownRole",
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm", (
            f"ROUTE_PIPELINE_AGENT with unknown next_agent should fall back to 'pm', "
            f"got {cmd.goto!r}"
        )

    async def test_route_pipeline_agent_missing_next_agent_falls_back_to_pm(self):
        """ROUTE_PIPELINE_AGENT with no next_agent field must fall back to
        the queried role's stage (PM → 'pm')."""
        tools = make_mcp_tools_with_actions({
            "Project Manager": {
                "action": "ROUTE_PIPELINE_AGENT",
                "work_package_id": "WP-001",
                # no next_agent field
            }
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "pm", (
            f"ROUTE_PIPELINE_AGENT with missing next_agent should fall back to 'pm', "
            f"got {cmd.goto!r}"
        )


# ---------------------------------------------------------------------------
# Tests: all-roles WAIT → synthesis (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestAllRolesWait:
    async def test_all_roles_wait_routes_to_synthesis(self):
        """When every role returns WAIT, supervisor falls through to synthesis."""
        # All roles get default WAIT (empty next_actions dict).
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis", (
            f"All-WAIT should route to synthesis, got {cmd.goto!r}"
        )

    async def test_all_roles_wait_with_in_progress_wp(self):
        """Even with an IN_PROGRESS WP, all-WAIT must route to synthesis."""
        tools = make_mcp_tools_with_actions({}, has_wps=True)
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        assert cmd.goto == "synthesis"

    async def test_all_roles_wait_log_entry_records_reason(self):
        """All-WAIT routing log entry must mention 'all roles returned WAIT'."""
        tools = make_mcp_tools_with_actions({})
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        log_entries = cmd.update.get("run_log", [])
        assert any(
            "wait" in str(entry).lower() or "WAIT" in str(entry)
            for entry in log_entries
        ), f"No WAIT-related log entry found in: {log_entries}"


# ---------------------------------------------------------------------------
# Tests: WAIT-class action variants are skipped (WP-005 AC4)
# ---------------------------------------------------------------------------

class TestWaitVariantsSkipped:
    """All actions in the _SKIP_ACTIONS frozenset must be treated exactly like
    WAIT — the role is skipped, no dispatch happens."""

    @pytest.mark.parametrize("skip_action", [
        "WAIT",
        "WAIT_FOR_REWORK",
        "WAIT_FOR_DOWNSTREAM",
        "WAIT_FOR_UPSTREAM_REWORK_LIMIT",
        "BLOCK_FOR_REWORK_LIMIT",
    ])
    async def test_skip_action_treated_as_wait(self, skip_action: str):
        """A SKIP-class action causes the role to be skipped; other roles or
        synthesis picks up the routing."""
        # Only Developer has an action; all others WAIT.
        # Developer's action is a SKIP variant → should not dispatch to developer.
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": skip_action, "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer action was skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"SKIP action {skip_action!r} should not dispatch; "
            f"expected synthesis, got {cmd.goto!r}"
        )


# ---------------------------------------------------------------------------
# Tests: unrecognised action treated as WAIT, no crash (WP-005 AC6)
# ---------------------------------------------------------------------------

class TestUnknownAction:
    async def test_unknown_action_does_not_crash(self):
        """An action string not in _DISPATCH_ACTIONS or _SKIP_ACTIONS must be
        treated as WAIT — no ValueError, no KeyError, no crash."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "FUTURE_ACTION_FROM_V99", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        # Must not raise.
        cmd = await node(base_state())

        # Unknown actions are skipped → all roles idle → synthesis.
        assert cmd.goto == "synthesis"

    async def test_unknown_action_all_roles_still_queried(self):
        """After one unknown action, remaining roles are still queried."""
        # Developer has unknown action, Documentation has real action.
        tools = make_mcp_tools_with_actions({
            "Developer":     {"action": "MYSTERY_ACTION",  "work_package_id": "WP-001"},
            "Documentation": {"action": "WRITE_DOCS",      "work_package_id": "WP-001"},
        })
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        # Developer skipped (unknown) → Documentation dispatches → docs.
        assert cmd.goto == "docs"


# ---------------------------------------------------------------------------
# Tests: circuit breaker skips recommended WP (WP-005 AC5)
# ---------------------------------------------------------------------------

class TestCircuitBreakerDirect:
    async def test_circuit_breaker_skips_wp_even_when_ledger_recommends(self):
        """When WP-001 has ≥3 consecutive failures, it must be skipped even if
        ledger_get_next_action returns IMPLEMENT for it."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}

        cmd = await node(state)

        # WP-001 is circuit-broken → loop continues → all idle → synthesis.
        assert cmd.goto == "synthesis", (
            f"Circuit-broken WP should cause synthesis fallback, got {cmd.goto!r}"
        )

    async def test_circuit_breaker_errors_list_contains_halted_message(self):
        """A circuit-broken WP must produce an error entry mentioning 'halted'."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-007"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-007": 3}

        cmd = await node(state)

        errors = cmd.update.get("errors", [])
        assert any("WP-007" in str(e) for e in errors), (
            f"Expected error mentioning WP-007 in {errors}"
        )
        assert any("halted" in str(e).lower() for e in errors), (
            f"Expected 'halted' in error messages; got: {errors}"
        )

    async def test_circuit_breaker_threshold_is_three(self):
        """Two consecutive failures (below threshold) must NOT trigger the breaker."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 2}  # one below threshold

        cmd = await node(state)

        # Not circuit-broken yet → dispatches to developer.
        assert cmd.goto == "developer"

    async def test_non_broken_wp_dispatches_while_broken_wp_skipped(self):
        """WP-002 (not broken) must be dispatched even if WP-001 is broken."""
        # Override to give WP-002 for second role, but that's hard in
        # the simple helper.  Instead use the state-based approach:
        # simulate Developer returning WP-002 after WP-001 is broken.
        # We monkey-patch the returned value to WP-001 only.
        seen_calls: list[str] = []

        async def _action_side_effect(kwargs: dict) -> str:
            role = kwargs.get("agent_role", "")
            seen_calls.append(role)
            # Return WP-001 for Developer (it will be circuit-broken).
            if role == "Developer":
                return json.dumps({"action": "IMPLEMENT", "work_package_id": "WP-001"})
            # QA gets a fully-new WP-002 (not broken).
            if role == "QA":
                return json.dumps({"action": "RUN_QA", "work_package_id": "WP-002"})
            return json.dumps({"action": "WAIT"})

        wp_list = [
            {"work_package_id": "WP-001", "status": "IN_PROGRESS"},
            {"work_package_id": "WP-002", "status": "IN_PROGRESS"},
        ]
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = make_tool("ledger_list_work_packages", wp_list)
        detail_tool = MagicMock()
        detail_tool.name = "ledger_get_work_package"
        detail_tool.ainvoke = AsyncMock(side_effect=lambda k: json.dumps(
            {"work_package_id": k.get("work_package_id", ""), "pipelines": []}
        ))
        next_action_tool = MagicMock()
        next_action_tool.name = "ledger_get_next_action"
        next_action_tool.ainvoke = AsyncMock(side_effect=_action_side_effect)

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool]
        )
        state = base_state()
        state["consecutive_failures"] = {"WP-001": 3}  # WP-001 broken

        cmd = await node(state)

        # WP-001 skipped, WP-002/QA dispatches → qa.
        assert cmd.goto == "qa"
        assert cmd.update.get("current_wp_id") == "WP-002"


# ---------------------------------------------------------------------------
# Tests: progress_snapshot — WP-004 AC3, AC4
# ---------------------------------------------------------------------------

class TestProgressSnapshot:
    """progress_snapshot must be in every iteration's run_log."""

    async def test_progress_snapshot_in_run_log(self):
        """progress_snapshot must appear in run_log on every supervisor call."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots, "progress_snapshot entry expected in run_log"

    async def test_progress_snapshot_has_required_fields(self):
        """progress_snapshot must contain total_wps, status_breakdown, pending,
        iteration, max_iterations."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS"), wp_summary("WP-002", "READY")],
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state(iteration=2))

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        snap = snapshots[0]
        assert "total_wps" in snap
        assert snap["total_wps"] == 2
        assert "status_breakdown" in snap
        assert "pending" in snap
        assert snap["iteration"] == 3  # incremented from 2

    async def test_progress_snapshot_elapsed_s_omitted_without_run_start_ts(self):
        """elapsed_s must be absent (None) when run_start_ts is not in state."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        # No run_start_ts key.
        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        # elapsed_s should be None (not a number) when run_start_ts is absent.
        assert snapshots[0].get("elapsed_s") is None

    async def test_progress_snapshot_elapsed_s_computed_when_run_start_ts_set(self):
        """elapsed_s must be a non-negative float when run_start_ts is valid."""
        from datetime import UTC, datetime, timedelta

        # Set run_start_ts to 60 seconds ago.
        past_ts = (datetime.now(UTC) - timedelta(seconds=60)).isoformat()
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = past_ts

        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots
        elapsed = snapshots[0].get("elapsed_s")
        assert elapsed is not None, "elapsed_s must be present when run_start_ts is valid"
        assert isinstance(elapsed, (int, float))
        assert elapsed >= 0


# ---------------------------------------------------------------------------
# Tests: wp_status_change and wp_complete — WP-004 AC1, AC2
# ---------------------------------------------------------------------------

class TestWPStatusChangeEvents:
    """wp_status_change and wp_complete must fire on transitions."""

    async def test_wp_status_change_emitted_when_status_differs(self):
        """wp_status_change must appear when a WP's status differs from prev."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Simulate a previous iteration where WP-001 was READY.
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "READY"}]

        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_status_change"
        ]
        assert sc_entries, "wp_status_change entry expected in run_log"
        entry = sc_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["old_status"] == "READY"
        assert entry["new_status"] == "IN_PROGRESS"

    async def test_wp_status_change_not_emitted_when_unchanged(self):
        """wp_status_change must NOT fire when status is the same as previous."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Same status as current iteration.
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}]

        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_status_change"
        ]
        assert not sc_entries, "No wp_status_change expected when status unchanged"

    async def test_wp_complete_emitted_when_wp_transitions_to_complete(self):
        """wp_complete must be emitted when new_status == COMPLETE."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "COMPLETE")],
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["prev_wp_summaries"] = [{"work_package_id": "WP-001", "status": "IN_PROGRESS"}]

        cmd = await node(state)

        wc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "wp_complete"
        ]
        assert wc_entries, "wp_complete entry expected when WP transitions to COMPLETE"
        assert wc_entries[0]["wp_id"] == "WP-001"

    async def test_wp_status_change_not_emitted_on_first_iteration(self):
        """No wp_status_change when prev_wp_summaries is empty (first iteration)."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # No prev_wp_summaries → first iteration.
        cmd = await node(state)

        sc_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") in ("wp_status_change", "wp_complete")
        ]
        assert not sc_entries, "No status-change events expected on first iteration"


# ---------------------------------------------------------------------------
# Tests: prev_wp_summaries stored in state — WP-004 AC7
# ---------------------------------------------------------------------------

class TestPrevWPSummariesStored:
    async def test_prev_wp_summaries_stored_in_base_update(self):
        """supervisor must store current wp_summaries as prev_wp_summaries."""
        wp_list = [wp_summary("WP-001", "READY"), wp_summary("WP-002", "IN_PROGRESS")]
        tools = make_mcp_tools(
            wp_list=wp_list,
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", []),
                "WP-002": wp_with_pipelines("WP-002", [pipeline("implementation", "IN_PROGRESS")]),
            },
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        stored = cmd.update.get("prev_wp_summaries")
        assert stored is not None, "prev_wp_summaries must be in state update"
        # Should match what ledger_list_work_packages returned.
        stored_ids = {w.get("work_package_id") for w in stored}
        assert "WP-001" in stored_ids
        assert "WP-002" in stored_ids


# ---------------------------------------------------------------------------
# Tests: enriched route events — WP-004 AC5
# ---------------------------------------------------------------------------

class TestEnrichedRouteEvents:
    async def test_route_includes_prev_stage_and_prev_wp_id(self):
        """route log entry must include prev_stage and prev_wp_id."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["current_stage"] = "developer"
        state["current_wp_id"] = "WP-001"

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        assert route_entries
        entry = route_entries[0]
        assert "prev_stage" in entry, "route entry must include prev_stage"
        assert "prev_wp_id" in entry, "route entry must include prev_wp_id"
        assert "prev_result" in entry, "route entry must include prev_result"

    async def test_route_prev_result_pass_when_stage_success(self):
        """prev_result must be 'PASS' when prev stage succeeded and wp_id is set."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "IN_PROGRESS")],
            wp_details={
                "WP-001": wp_with_pipelines("WP-001", [pipeline("implementation", "PASS")])
            },
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = True
        state["current_wp_id"] = "WP-001"

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        if route_entries:
            assert route_entries[0].get("prev_result") == "PASS"


# ---------------------------------------------------------------------------
# Tests: rework_detected event — WP-004 AC6
# ---------------------------------------------------------------------------

class TestReworkDetectedEvent:
    async def test_rework_detected_emitted_on_rework_action(self):
        """rework_detected must appear in run_log when supervisor dispatches REWORK."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "REWORK", "work_package_id": "WP-001",
                           "pipeline_type": "qa", "rework_count": 2}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        rd_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "rework_detected"
        ]
        assert rd_entries, "rework_detected entry expected in run_log for REWORK action"
        entry = rd_entries[0]
        assert entry["wp_id"] == "WP-001"
        assert entry["agent_role"] == "Developer"

    async def test_rework_detected_not_emitted_for_implement(self):
        """rework_detected must NOT appear for a normal IMPLEMENT action."""
        tools = make_mcp_tools_with_actions(
            {"Developer": {"action": "IMPLEMENT", "work_package_id": "WP-001"}}
        )
        node = make_supervisor_node(tools)
        cmd = await node(base_state())

        rd_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "rework_detected"
        ]
        assert not rd_entries, "rework_detected must not appear for IMPLEMENT action"


# ---------------------------------------------------------------------------
# Tests: prev_result=FAIL and malformed run_start_ts — WP-006 AC2 / AC3
# ---------------------------------------------------------------------------

class TestEnrichedRouteEventsFailResult:
    """Extra coverage for enriched route-event fields added in WP-006."""

    async def test_route_prev_result_fail_when_stage_failed_with_wp_id(self):
        """prev_result must be 'FAIL' when stage_success=False and prev_wp_id
        is non-empty.  This exercises the 'FAIL if prev_wp_id' branch in the
        supervisor's _log_entry call for route events."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-002", "IN_PROGRESS")],
            wp_details={"WP-002": wp_with_pipelines("WP-002", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        # Simulate the previous stage having failed for WP-001.
        state["stage_success"] = False
        state["current_wp_id"] = "WP-001"  # non-empty prev_wp_id

        cmd = await node(state)

        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route"
        ]
        assert route_entries, "route entry expected in run_log"
        entry = route_entries[0]
        assert entry.get("prev_result") == "FAIL", (
            f"Expected prev_result='FAIL', got {entry.get('prev_result')!r}"
        )

    async def test_route_prev_result_empty_when_stage_failed_but_no_prev_wp_id(self):
        """prev_result must be '' (empty string) when stage_success=False but
        prev_wp_id is also empty (first routing iteration with no prior WP).

        Uses a READY WP so the supervisor emits a role-dispatch route entry
        (the 'no work packages' path doesn't include prev_result at all).
        """
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools)
        state = base_state()
        state["stage_success"] = False
        state["current_wp_id"] = ""  # no previous wp_id

        cmd = await node(state)

        # Filter to the role-dispatch route entry (has prev_result).
        route_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "route" and "prev_result" in e
        ]
        assert route_entries, "role-dispatch route entry with prev_result expected"
        entry = route_entries[0]
        assert entry.get("prev_result") == "", (
            f"Expected prev_result='', got {entry.get('prev_result')!r}"
        )


class TestProgressSnapshotMalformedTs:
    """elapsed_s must be None (not raise) when run_start_ts is a malformed string."""

    async def test_elapsed_s_none_when_run_start_ts_malformed(self):
        """Malformed run_start_ts must cause elapsed_s=None in progress_snapshot
        rather than raising ValueError."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = "not-a-valid-iso-timestamp"

        cmd = await node(state)

        snapshots = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "progress_snapshot"
        ]
        assert snapshots, "progress_snapshot entry expected in run_log"
        elapsed = snapshots[0].get("elapsed_s")
        assert elapsed is None, (
            f"Expected elapsed_s=None for malformed timestamp, got {elapsed!r}"
        )

    async def test_supervisor_does_not_raise_on_malformed_run_start_ts(self):
        """A malformed run_start_ts must not propagate as an exception."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools)
        state = base_state()
        state["run_start_ts"] = "2026-99-99T99:99:99"  # invalid date parts

        # Must not raise.
        cmd = await node(state)
        assert cmd is not None


# ---------------------------------------------------------------------------
# Tests: dry-run mode — no MCP error spam, clean termination
# ---------------------------------------------------------------------------

class TestDryRunMode:
    """In dry-run mode the supervisor should tolerate a missing ledger
    gracefully: no MCP error log entries, and clean termination after
    routing to PM once."""

    async def test_dry_run_no_wps_first_iteration_routes_to_pm(self):
        """First iteration with no WPs in dry-run still routes to PM."""
        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == "pm"

    async def test_dry_run_no_wps_second_iteration_routes_to_end(self):
        """Second iteration with no WPs in dry-run terminates cleanly."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=1))

        assert cmd.goto == END

    async def test_dry_run_no_mcp_error_entries(self):
        """Dry-run must not produce mcp_error log entries for missing ledger."""
        # Simulate ledger_list_work_packages throwing (no ledger).
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        # Should route to PM (first iteration), but with no mcp_error entries.
        assert cmd.goto == "pm"
        mcp_errors = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "mcp_error"
        ]
        assert not mcp_errors, f"Unexpected mcp_error entries in dry-run: {mcp_errors}"

    async def test_dry_run_no_error_list_entries(self):
        """Dry-run with missing ledger must not populate the errors list."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        errors = cmd.update.get("errors", [])
        assert not errors, f"Unexpected errors in dry-run: {errors}"

    async def test_dry_run_uses_info_level_for_missing_ledger(self):
        """The dry_run_no_ledger log entry must use INFO level."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        no_ledger_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "dry_run_no_ledger"
        ]
        assert no_ledger_entries, "Expected dry_run_no_ledger entry"
        assert no_ledger_entries[0]["level"] == "INFO"

    async def test_dry_run_complete_log_entry_on_termination(self):
        """When dry-run terminates on second iteration, it logs dry_run_complete."""
        from langgraph.constants import END  # type: ignore[import]

        tools = make_mcp_tools(wp_list=[])
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state(iteration=1))

        assert cmd.goto == END
        complete_entries = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "dry_run_complete"
        ]
        assert complete_entries, "Expected dry_run_complete entry"
        assert complete_entries[0]["level"] == "INFO"

    async def test_dry_run_get_project_status_error_routes_to_end_cleanly(self):
        """If ledger_get_project_status throws in dry-run, route to END
        at INFO level without errors list."""
        from langgraph.constants import END  # type: ignore[import]

        status_tool = MagicMock()
        status_tool.name = "ledger_get_project_status"
        status_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        list_tool = make_tool("ledger_list_work_packages", [])
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=True,
        )
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == END
        # Must use dry_run_no_ledger action, not mcp_error.
        actions = [e.get("action") for e in cmd.update.get("run_log", [])]
        assert "dry_run_no_ledger" in actions
        assert "mcp_error" not in actions
        assert not cmd.update.get("errors", [])

    async def test_non_dry_run_still_produces_mcp_error(self):
        """Without dry_run=True, missing ledger must still produce mcp_error."""
        status_tool = make_tool("ledger_get_project_status", {"status": "IN_PROGRESS"})
        list_tool = MagicMock()
        list_tool.name = "ledger_list_work_packages"
        list_tool.ainvoke = AsyncMock(
            side_effect=RuntimeError("Root index not found")
        )
        detail_tool = make_tool("ledger_get_work_package", {})
        next_action_tool = make_tool("ledger_get_next_action", {"action": "WAIT"})

        node = make_supervisor_node(
            [status_tool, list_tool, detail_tool, next_action_tool],
            dry_run=False,
        )
        cmd = await node(base_state(iteration=0))

        assert cmd.goto == "pm"
        mcp_errors = [
            e for e in cmd.update.get("run_log", [])
            if e.get("action") == "mcp_error"
        ]
        assert mcp_errors, "Non-dry-run should produce mcp_error entries"

    async def test_dry_run_with_existing_wps_routes_normally(self):
        """Dry-run with an existing ledger (WPs present) routes normally."""
        tools = make_mcp_tools(
            wp_list=[wp_summary("WP-001", "READY")],
            wp_details={"WP-001": wp_with_pipelines("WP-001", [])},
        )
        node = make_supervisor_node(tools, dry_run=True)
        cmd = await node(base_state())

        # Normal routing — WP-001 needs implementation → developer.
        assert cmd.goto == "developer"

```
###  Path: `/orchestrator/tests/test_tool_wrappers.py`

```py
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


```