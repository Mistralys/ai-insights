"""Cross-platform file locking (Unix fcntl / Windows msvcrt)."""
from __future__ import annotations

import sys

if sys.platform == "win32":
    import msvcrt

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention.

        Windows note: ``msvcrt.locking`` locks 1 byte at the *current file
        pointer position*.  The caller must ensure the file pointer stays at 0
        (e.g. open the lock file in ``'w'`` mode and never write to it) so that
        the locked byte is identical for every acquire/release cycle.

        Not re-entrant: calling this twice on the same fd without an intervening
        ``unlock`` raises ``OSError`` (EACCES / errno 13).
        """
        msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)

    def unlock(fd: int) -> None:
        """Release the lock. Silently swallows ``OSError`` if the fd is not locked."""
        try:
            msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        except OSError:
            pass

else:
    import fcntl

    def lock_exclusive(fd: int) -> None:
        """Acquire a non-blocking exclusive lock. Raises OSError on contention."""
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def unlock(fd: int) -> None:
        """Release the lock. Silently swallows ``OSError`` if the fd is not locked."""
        try:
            fcntl.flock(fd, fcntl.LOCK_UN)
        except OSError:
            pass
