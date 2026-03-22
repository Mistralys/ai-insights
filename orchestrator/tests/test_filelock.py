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
