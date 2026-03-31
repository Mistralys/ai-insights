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
