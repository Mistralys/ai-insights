"""
test_path_middleware.py — Unit tests for PathNormalizationMiddleware.

Tests cover:
- Basic Windows path rewriting (drive-letter path → virtual /\u2011rooted path)
- Case-insensitive root matching
- Backslash normalization
- Paths outside root_dir pass through unchanged
- POSIX paths pass through unchanged (AC5: no-op on macOS/Linux)
- Plain strings pass through unchanged
- _rewrite_args returns None when no changes are needed
- Multiple args in one call — only matching ones are rewritten
- Empty args dict handled gracefully
- Root-dir-only path rewrites to /
- Full middleware flow: awrap_tool_call rewrites then delegates
- Full middleware flow: awrap_tool_call passes through without modification- Smoke tests with a real ToolCallRequest dataclass (catches API drift in override())"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from langchain.tools.tool_node import ToolCallRequest, ToolRuntime

from src.utils.path_middleware import PathNormalizationMiddleware

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_request(args: dict[str, Any], name: str = "read_file") -> MagicMock:
    """Return a minimal mock ToolCallRequest with the given args."""
    request = MagicMock()
    request.tool_call = {"name": name, "args": args, "id": "test-call-id"}

    def _override(**kwargs: Any) -> MagicMock:
        new_req = MagicMock()
        new_req.tool_call = kwargs.get("tool_call", request.tool_call)
        # Allow chained overrides
        new_req.override = lambda **kw: _override(**kw)
        return new_req

    request.override = _override
    return request


def _make_real_request(args: dict[str, Any], name: str = "read_file") -> ToolCallRequest:
    """Return a real ToolCallRequest dataclass instance with the given args."""
    return ToolCallRequest(
        tool_call={"name": name, "args": args, "id": "test-call-id"},
        tool=None,
        state={},
        runtime=ToolRuntime(
            state={},
            context={},
            config={},
            stream_writer=None,
            tool_call_id=None,
            store=None,
        ),
    )


# ---------------------------------------------------------------------------
# Tests: _to_virtual (path rewriting logic)
# ---------------------------------------------------------------------------

class TestToVirtual:
    def test_basic_windows_path_rewrite(self):
        """Windows path within root_dir is rewritten to a virtual /\u2011rooted path."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._to_virtual(r"F:\Webserver\project\src\file.ts")
        assert result == "/src/file.ts"

    def test_case_insensitive_root_match(self):
        """Matching is case-insensitive — lowercase input matches uppercase root."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._to_virtual(r"f:\webserver\project\src\file.ts")
        assert result == "/src/file.ts"

    def test_backslash_normalization(self):
        """Mixed backslash/forward-slash separators in input are normalized."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._to_virtual(r"F:/Webserver\project/src\file.ts")
        assert result == "/src/file.ts"

    def test_root_dir_only_rewrites_to_slash(self):
        """A path equal to root_dir rewrites to '/'."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._to_virtual(r"F:\Webserver\project")
        assert result == "/"

    def test_path_outside_root_unchanged(self):
        """A Windows path that does not start with root_dir is not modified."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        value = r"D:\other\workspace\file.ts"
        result = mw._to_virtual(value)
        assert result == value

    def test_path_outside_root_different_drive_unchanged(self):
        """A Windows path on a different drive is not modified."""
        mw = PathNormalizationMiddleware(r"C:\Users\dev\project")
        value = r"D:\Users\dev\project\file.ts"
        result = mw._to_virtual(value)
        assert result == value

    def test_posix_path_returned_unchanged(self):
        """A POSIX path does not start with root_dir and is returned unchanged."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        value = "/usr/local/bin"
        result = mw._to_virtual(value)
        assert result == value


# ---------------------------------------------------------------------------
# Tests: _rewrite_args
# ---------------------------------------------------------------------------

class TestRewriteArgs:
    def test_matching_arg_is_rewritten(self):
        """A Windows path arg matching root_dir is rewritten."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({"path": r"F:\Webserver\project\src\app.py"})
        assert result is not None
        assert result["path"] == "/src/app.py"

    def test_no_rewrite_returns_none(self):
        """_rewrite_args returns None when no args need rewriting."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({"query": "print('hello')"})
        assert result is None

    def test_path_outside_root_returns_none(self):
        """A Windows path outside root_dir is not rewritten → returns None."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({"path": r"D:\other\file.ts"})
        assert result is None

    def test_posix_path_returns_none(self):
        """A POSIX path arg returns None (no changes)."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({"path": "/home/user/file.py"})
        assert result is None

    def test_plain_string_returns_none(self):
        """A non-path string returns None (no changes)."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({"pattern": "*.ts"})
        assert result is None

    def test_empty_args_returns_none(self):
        """An empty args dict returns None without error."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({})
        assert result is None

    def test_multiple_args_only_matching_rewritten(self):
        """Only args matching root_dir are rewritten; others pass through unchanged."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({
            "path": r"F:\Webserver\project\src\module.py",
            "query": "*.py",
            "outside": r"D:\other\file.ts",
            "posix": "/home/user/notes.md",
        })
        assert result is not None
        assert result["path"] == "/src/module.py"
        assert result["query"] == "*.py"
        assert result["outside"] == r"D:\other\file.ts"
        assert result["posix"] == "/home/user/notes.md"

    def test_inactive_on_posix_root_returns_none(self):
        """When root_dir is a POSIX path, middleware is inactive — always returns None."""
        mw = PathNormalizationMiddleware("/home/user/project")
        assert not mw._active
        result = mw._rewrite_args({"path": "/home/user/project/file.py"})
        assert result is None

    def test_non_string_values_ignored(self):
        """Non-string arg values are not inspected and do not cause errors."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        result = mw._rewrite_args({
            "count": 42,
            "flag": True,
            "items": ["a", "b"],
            "path": r"F:\Webserver\project\file.ts",
        })
        assert result is not None
        assert result["path"] == "/file.ts"
        assert result["count"] == 42
        assert result["flag"] is True
        assert result["items"] == ["a", "b"]


# ---------------------------------------------------------------------------
# Tests: PathNormalizationMiddleware._active flag
# ---------------------------------------------------------------------------

class TestActiveFlag:
    def test_active_for_windows_root(self):
        """_active is True when root_dir starts with a drive letter."""
        mw = PathNormalizationMiddleware(r"C:\Users\dev\project")
        assert mw._active is True

    def test_active_for_lowercase_drive(self):
        """_active is True for lowercase drive letters."""
        mw = PathNormalizationMiddleware(r"c:\users\dev\project")
        assert mw._active is True

    def test_inactive_for_posix_root(self):
        """_active is False when root_dir is a POSIX path."""
        mw = PathNormalizationMiddleware("/home/user/project")
        assert mw._active is False

    def test_inactive_for_empty_root(self):
        """_active is False when root_dir is empty."""
        mw = PathNormalizationMiddleware("")
        assert mw._active is False


# ---------------------------------------------------------------------------
# Tests: awrap_tool_call (full middleware flow)
# ---------------------------------------------------------------------------

class TestAwrapToolCall:
    async def test_awrap_tool_call_rewrites_matching_path(self):
        """awrap_tool_call rewrites matching Windows paths before delegating."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        request = _make_request({"path": r"F:\Webserver\project\src\app.py"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        handled_req = received_requests[0]
        assert handled_req.tool_call["args"]["path"] == "/src/app.py"

    async def test_awrap_tool_call_passthrough_when_no_rewrite_needed(self):
        """awrap_tool_call passes original request to handler when no rewriting needed."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        request = _make_request({"pattern": "*.py"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        # The original request object should have been passed (no override)
        assert received_requests[0] is request

    async def test_awrap_tool_call_inactive_on_posix_root(self):
        """awrap_tool_call is a no-op pass-through when root_dir is a POSIX path."""
        mw = PathNormalizationMiddleware("/home/user/project")
        request = _make_request({"path": "/home/user/project/file.py"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        assert received_requests[0] is request

    async def test_awrap_tool_call_returns_handler_result(self):
        """awrap_tool_call returns whatever the handler returns."""
        mw = PathNormalizationMiddleware(r"C:\project")
        request = _make_request({})
        expected = object()

        async def _handler(req: Any) -> Any:
            return expected

        result = await mw.awrap_tool_call(request, _handler)
        assert result is expected

    async def test_awrap_tool_call_empty_args(self):
        """awrap_tool_call handles an empty args dict without error."""
        mw = PathNormalizationMiddleware(r"F:\project")
        request = _make_request({})

        called = []

        async def _handler(req: Any) -> str:
            called.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)
        assert called, "handler must be called even with empty args"


# ---------------------------------------------------------------------------
# Smoke tests: awrap_tool_call with a real ToolCallRequest
# Catches API drift in ToolCallRequest.override() — if the dataclass fields or
# override() signature change, construction or the call below will raise.
# ---------------------------------------------------------------------------

class TestAwrapToolCallWithRealRequest:
    async def test_real_request_rewrites_windows_path(self):
        """awrap_tool_call rewrites a Windows path inside a real ToolCallRequest."""
        mw = PathNormalizationMiddleware(r"C:\project")
        request = _make_real_request({"path": r"C:\project\src\file.ts"})

        received: list[ToolCallRequest] = []

        async def _handler(req: ToolCallRequest) -> str:
            received.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0].tool_call["args"]["path"] == "/src/file.ts"

    async def test_real_request_passthrough_when_no_rewrite_needed(self):
        """awrap_tool_call passes the original real ToolCallRequest unchanged."""
        mw = PathNormalizationMiddleware(r"C:\project")
        request = _make_real_request({"query": "*.py"})

        received: list[ToolCallRequest] = []

        async def _handler(req: ToolCallRequest) -> str:
            received.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0] is request

    async def test_real_request_override_produces_real_instance(self):
        """override() on a real ToolCallRequest returns a ToolCallRequest, not a mock."""
        mw = PathNormalizationMiddleware(r"C:\project")
        request = _make_real_request({"path": r"C:\project\file.ts"})

        received: list[ToolCallRequest] = []

        async def _handler(req: ToolCallRequest) -> str:
            received.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert isinstance(received[0], ToolCallRequest)
