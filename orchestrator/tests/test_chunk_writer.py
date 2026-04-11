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
