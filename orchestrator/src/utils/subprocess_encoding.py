"""
subprocess_encoding — Windows subprocess text-mode encoding fix.

On Windows, ``subprocess.Popen(text=True)`` defaults to the system codepage
(e.g. CP1252) with ``errors='strict'``.  When the child process outputs bytes
that are invalid in that codepage — or invalid UTF-8 when ``PYTHONUTF8=1`` is
set — the internal ``_readerthread`` used by ``Popen.communicate()`` crashes
with ``UnicodeDecodeError``, silently breaking the communication pipe.

This module monkeypatches ``subprocess.Popen.__init__`` to inject
``errors='replace'`` whenever text mode is requested and no explicit ``errors``
parameter was provided.  This ensures undecodable bytes are replaced with the
Unicode replacement character (U+FFFD) instead of crashing the reader thread.

The patch is **idempotent** and **no-op on non-Windows** platforms.

Typical usage — import once at the top of the CLI entry point::

    import src.utils.subprocess_encoding  # noqa: F401  # side-effect: patches subprocess
"""

from __future__ import annotations

import subprocess
import sys

_PATCHED = False


def _apply_patch() -> None:
    """Monkeypatch ``subprocess.Popen.__init__`` with safe text-mode defaults."""
    global _PATCHED  # noqa: PLW0603
    if _PATCHED or sys.platform != "win32":
        return

    _orig_init = subprocess.Popen.__init__

    def _patched_init(self: subprocess.Popen, *args: object, **kwargs: object) -> None:  # type: ignore[type-arg]
        # Only inject errors='replace' when text mode is active and no
        # explicit errors= was provided by the caller.
        text_mode = kwargs.get("text") or kwargs.get("universal_newlines")
        encoding = kwargs.get("encoding")
        # text=True, OR an explicit encoding= both enable text mode in Popen.
        if (text_mode or encoding is not None) and "errors" not in kwargs:
            kwargs["errors"] = "replace"
        _orig_init(self, *args, **kwargs)  # type: ignore[arg-type]

    subprocess.Popen.__init__ = _patched_init  # type: ignore[assignment]
    _PATCHED = True


# Apply the patch on import.
_apply_patch()
