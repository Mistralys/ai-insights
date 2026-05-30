"""
chunk_writer.py — Utility class for writing raw LangGraph stream chunks to JSONL files.

Public API
----------
ChunkWriter(slug_dir, wp_id, stage)
    Opens (or creates) a JSONL file at
    ``{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl``,
    writing a version-header line as the very first entry.

    Revision numbering mirrors :func:`~src.utils.dialogue_writer.write_dialogue`:
    glob ``{wp_id}-{stage}-r*.jsonl`` and take ``max(revisions) + 1`` (or 0
    when no prior files exist).

Usage::

    from pathlib import Path
    from src.utils.chunk_writer import ChunkWriter

    with ChunkWriter(slug_dir=Path("/storage/my-project"), wp_id="WP-001", stage="developer") as cw:
        for chunk in stream:
            cw.write_chunk(chunk)

    # path property exposes the file that was written
    print(cw.path)

JSONL file layout
-----------------
Line 0 (header)::

    {"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}

Lines 1-N (chunks)::

    {"type": "ai", "content": "…", …}

.. note:: Cross-language coupling
    The subdirectory path ``orchestrator/chunks`` is intentionally parallel to
    ``orchestrator/dialogues`` used by :func:`~src.utils.dialogue_writer.write_dialogue`.
    If the root path ever changes both modules must be updated together.

.. warning:: _CHUNK_HEADER is a private implementation detail
    ``_CHUNK_HEADER`` is a module-level mutable dict.  Do **not** mutate it
    from outside this module — external mutation silently corrupts the header
    line written to every subsequently opened chunk file.  It is exposed at
    the module level solely so that tests can assert on its contents.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from types import MappingProxyType
from typing import IO, Any

from src.utils._revision import next_revision

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Header written as the first line of every chunk file
# ---------------------------------------------------------------------------

# DO NOT MUTATE — this mapping is a module-level singleton shared across all
# ChunkWriter instances.  It is wrapped in MappingProxyType to enforce
# immutability at runtime.  External mutation would silently corrupt the header
# line of every subsequently opened chunk file.  If you need a different
# header, subclass ChunkWriter or construct the dict locally.
_CHUNK_HEADER: MappingProxyType[str, Any] = MappingProxyType({
    "chunk_format": 1,
    "stream_mode": "messages",
    "langgraph_stream_version": "v2",
})


# ---------------------------------------------------------------------------
# ChunkWriter
# ---------------------------------------------------------------------------


class ChunkWriter:
    """Write raw LangGraph stream chunks to a JSONL file with immediate flush.

    Parameters
    ----------
    slug_dir:
        Root directory for the project's ledger storage
        (e.g. ``{workspace_root}/mcp-server/storage/ledger/{repo_name}/{slug}``).  
        *repo_name* is derived from the fourth ancestor of the plan directory;
        it defaults to ``'unknown'`` when the path is too short.
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    stage:
        Pipeline stage name (e.g. ``"developer"``).

    Raises
    ------
    OSError
        If the chunks directory cannot be created or the file cannot be
        opened.  Errors during :meth:`write_chunk` are **not** raised —
        they are logged at ``DEBUG`` and silently swallowed.
    """

    def __init__(self, slug_dir: Path, wp_id: str, stage: str) -> None:
        self._slug_dir = Path(slug_dir)
        self._wp_id = wp_id
        self._stage = stage
        self._closed: bool = False
        self._fh: IO[str] | None = None

        chunks_dir = self._slug_dir / "orchestrator" / "chunks"
        chunks_dir.mkdir(parents=True, exist_ok=True)

        revision = next_revision(chunks_dir, wp_id, stage, ".jsonl")
        filename = f"{wp_id}-{stage}-r{revision}.jsonl"
        dest = chunks_dir / filename
        self._path: Path = dest

        self._fh = dest.open("w", encoding="utf-8")
        # Write the version header as the first line.
        # dict() conversion is needed because json.dumps does not natively
        # serialise MappingProxyType.
        self._fh.write(json.dumps(dict(_CHUNK_HEADER), ensure_ascii=False) + "\n")
        self._fh.flush()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def path(self) -> Path:
        """Absolute path to the JSONL file being written."""
        return self._path

    def write_chunk(self, chunk: dict[str, Any]) -> None:
        """Append *chunk* as a JSON line and flush immediately.

        If a file I/O error or JSON serialisation error occurs, the exception
        is logged at ``DEBUG`` level and silently swallowed — the caller is
        never interrupted.

        Both :class:`OSError` (file I/O failures) and :class:`TypeError`
        (non-serialisable values such as ``set``, custom objects, ``bytes``)
        are caught and suppressed.

        Parameters
        ----------
        chunk:
            A dict representing a single LangGraph stream chunk.  All
            values should be JSON-serialisable; non-serialisable values
            are silently skipped.
        """
        if self._closed or self._fh is None:
            return
        try:
            self._fh.write(json.dumps(chunk, ensure_ascii=False) + "\n")
            self._fh.flush()
        except (OSError, TypeError) as exc:
            log.debug(
                "ChunkWriter.write_chunk: error writing to %s — %s",
                self._path,
                exc,
            )

    def close(self) -> None:
        """Close the underlying file handle.

        This method is idempotent — calling it more than once is safe and
        will not raise.
        """
        if self._closed:
            return
        self._closed = True
        if self._fh is not None:
            try:
                self._fh.close()
            except OSError as exc:
                log.debug("ChunkWriter.close: error closing %s — %s", self._path, exc)
            finally:
                self._fh = None

    def delete(self) -> None:
        """Close the writer and delete the chunk file from disk.

        Closes the underlying file handle first (idempotent), then removes
        the chunk file.  If the file does not exist the call completes
        silently without raising.  Any other :class:`OSError` is logged at
        ``DEBUG`` level and then silently swallowed — callers are never
        interrupted by cleanup failures.

        Intended for use when a stream retry discards a partial chunk file
        and a fresh write must start with a new file path.
        """
        self.close()
        try:
            self._path.unlink(missing_ok=True)
        except OSError as exc:
            log.debug("ChunkWriter.delete: error deleting %s — %s", self._path, exc)

    # ------------------------------------------------------------------
    # Context manager protocol
    # ------------------------------------------------------------------

    def __enter__(self) -> ChunkWriter:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.close()
