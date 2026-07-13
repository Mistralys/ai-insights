"""
test_path_middleware.py — Unit tests for PathNormalizationMiddleware.

Tests cover:
- Basic Windows path rewriting (drive-letter path → virtual /\u2011rooted path)
- Basic POSIX path rewriting (macOS/Linux absolute path → virtual /‑rooted path)
- Case-insensitive root matching
- Backslash normalization
- Paths outside root_dir pass through unchanged
- Virtual /‑rooted paths that do not match root_dir pass through unchanged
- Plain strings pass through unchanged
- _rewrite_args returns None when no changes are needed
- Multiple args in one call — only matching ones are rewritten
- Empty args dict handled gracefully
- Root-dir-only path rewrites to /
- Full middleware flow: awrap_tool_call rewrites then delegates
- Full middleware flow: awrap_tool_call passes through without modification
- Smoke tests with a real ToolCallRequest dataclass (catches API drift in override())
"""

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
        """A POSIX path that doesn't match root_dir prefix is returned unchanged."""
        mw = PathNormalizationMiddleware(r"F:\Webserver\project")
        value = "/usr/local/bin"
        result = mw._to_virtual(value)
        assert result == value

    def test_basic_posix_path_rewrite(self):
        """POSIX path within root_dir is rewritten to a virtual /‑rooted path."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._to_virtual("/Users/dev/project/src/file.ts")
        assert result == "/src/file.ts"

    def test_posix_root_dir_only_rewrites_to_slash(self):
        """A POSIX path equal to root_dir rewrites to '/'."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._to_virtual("/Users/dev/project")
        assert result == "/"

    def test_posix_path_outside_root_unchanged(self):
        """A POSIX path that does not start with root_dir is not modified."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        value = "/other/path/file.ts"
        result = mw._to_virtual(value)
        assert result == value

    def test_posix_case_insensitive_match(self):
        """POSIX matching is case-insensitive — macOS APFS scenario."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._to_virtual("/users/dev/project/file.ts")
        assert result == "/file.ts"


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
        """A POSIX path that does NOT match root_dir returns None (no changes)."""
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
        """When root_dir is a POSIX path, middleware IS active but only rewrites matching paths."""
        mw = PathNormalizationMiddleware("/home/user/project")
        assert mw._active
        # A path that does NOT match the root prefix should return None
        result = mw._rewrite_args({"path": "/other/dir/file.py"})
        assert result is None

    def test_posix_matching_arg_is_rewritten(self):
        """A macOS path matching root_dir is rewritten."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._rewrite_args({"path": "/Users/dev/project/src/app.py"})
        assert result is not None
        assert result["path"] == "/src/app.py"

    def test_posix_non_matching_arg_unchanged(self):
        """POSIX path NOT matching root returns None."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._rewrite_args({"path": "/tmp/scratch/file.py"})
        assert result is None

    def test_posix_virtual_path_passes_through(self):
        """/src/file.ts is not rewritten when root is /Users/dev/project."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._rewrite_args({"path": "/src/file.ts"})
        assert result is None

    def test_posix_mixed_args(self):
        """Only matching POSIX args are rewritten; others pass through unchanged."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        result = mw._rewrite_args({
            "path": "/Users/dev/project/src/module.py",
            "query": "*.py",
            "outside": "/tmp/other/file.ts",
            "virtual": "/src/existing.ts",
        })
        assert result is not None
        assert result["path"] == "/src/module.py"
        assert result["query"] == "*.py"
        assert result["outside"] == "/tmp/other/file.ts"
        assert result["virtual"] == "/src/existing.ts"

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

    def test_active_for_macos_root(self):
        """_active is True when root_dir is a macOS POSIX path."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        assert mw._active is True

    def test_active_for_linux_root(self):
        """_active is True when root_dir is a Linux POSIX path."""
        mw = PathNormalizationMiddleware("/home/user/project")
        assert mw._active is True

    def test_inactive_for_bare_slash(self):
        """_active is False when root_dir is bare '/' to avoid rewriting all virtual paths."""
        mw = PathNormalizationMiddleware("/")
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
        """awrap_tool_call rewrites matching POSIX paths (middleware is active on POSIX)."""
        mw = PathNormalizationMiddleware("/home/user/project")
        request = _make_request({"path": "/home/user/project/file.py"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        # The path matched the root prefix and should have been rewritten
        assert received_requests[0].tool_call["args"]["path"] == "/file.py"

    async def test_awrap_tool_call_rewrites_posix_path(self):
        """awrap_tool_call rewrites macOS absolute path to virtual path."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        request = _make_request({"path": "/Users/dev/project/src/app.py"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        assert received_requests[0].tool_call["args"]["path"] == "/src/app.py"

    async def test_awrap_tool_call_posix_virtual_path_passes_through(self):
        """awrap_tool_call does not rewrite a virtual /src/file.ts path with POSIX root."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        request = _make_request({"path": "/src/file.ts"})

        received_requests: list[Any] = []

        async def _handler(req: Any) -> str:
            received_requests.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received_requests, "handler was not called"
        # Virtual path does not match the root prefix — passes through unchanged
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

    async def test_real_request_rewrites_posix_path(self):
        """awrap_tool_call rewrites a POSIX path inside a real ToolCallRequest."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        request = _make_real_request({"path": "/Users/dev/project/src/file.ts"})

        received: list[ToolCallRequest] = []

        async def _handler(req: ToolCallRequest) -> str:
            received.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0].tool_call["args"]["path"] == "/src/file.ts"


# ---------------------------------------------------------------------------
# Tests: skip_tools (MCP tool exemption)
# ---------------------------------------------------------------------------

class TestSkipTools:
    async def test_skipped_tool_passes_through_unchanged(self):
        """A tool in skip_tools has its args forwarded unchanged, even when they match root_dir."""
        mw = PathNormalizationMiddleware(
            "/Users/dev/project",
            skip_tools=frozenset({"ledger_initialize_project"}),
        )
        request = _make_request(
            {"project_path": "/Users/dev/project/plans/my-plan"},
            name="ledger_initialize_project",
        )

        received: list[Any] = []

        async def _handler(req: Any) -> str:
            received.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        # The original request object must be passed through without any override.
        assert received[0] is request
        assert received[0].tool_call["args"]["project_path"] == "/Users/dev/project/plans/my-plan"

    async def test_non_skipped_tool_still_rewritten(self):
        """A tool NOT in skip_tools is rewritten as normal (regression guard)."""
        mw = PathNormalizationMiddleware(
            "/Users/dev/project",
            skip_tools=frozenset({"ledger_initialize_project"}),
        )
        request = _make_request(
            {"path": "/Users/dev/project/src/app.py"},
            name="read_file",
        )

        received: list[Any] = []

        async def _handler(req: Any) -> str:
            received.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0].tool_call["args"]["path"] == "/src/app.py"

    async def test_default_skip_tools_empty(self):
        """Default skip_tools=frozenset() — all tools are rewritten as before."""
        mw = PathNormalizationMiddleware("/Users/dev/project")
        assert mw._skip_tools == frozenset()
        request = _make_request(
            {"path": "/Users/dev/project/src/app.py"},
            name="ledger_initialize_project",
        )

        received: list[Any] = []

        async def _handler(req: Any) -> str:
            received.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        # Default: no skip_tools set, so the path is rewritten even for MCP-named tools.
        assert received[0].tool_call["args"]["path"] == "/src/app.py"

    async def test_skipped_tool_with_posix_path(self):
        """POSIX variant: a skipped MCP tool with a macOS absolute path is not rewritten."""
        mw = PathNormalizationMiddleware(
            "/Users/smordziol/Webserver/Workspaces/ai-insights/DEV/ai-insights",
            skip_tools=frozenset({"ledger_initialize_project", "ledger_create_work_package"}),
        )
        host_path = (
            "/Users/smordziol/Webserver/Workspaces/ai-insights/DEV/ai-insights"
            "/docs/agents/plans/2026-07-13-example"
        )
        request = _make_request(
            {"project_path": host_path},
            name="ledger_initialize_project",
        )

        received: list[Any] = []

        async def _handler(req: Any) -> str:
            received.append(req)
            return "result"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0] is request
        assert received[0].tool_call["args"]["project_path"] == host_path

    async def test_skip_tools_with_real_request(self):
        """Smoke test: skipped tool forwarded unchanged with a real ToolCallRequest."""
        mw = PathNormalizationMiddleware(
            "/Users/dev/project",
            skip_tools=frozenset({"ledger_initialize_project"}),
        )
        host_path = "/Users/dev/project/docs/agents/plans/my-plan"
        request = _make_real_request(
            {"project_path": host_path},
            name="ledger_initialize_project",
        )

        received: list[ToolCallRequest] = []

        async def _handler(req: ToolCallRequest) -> str:
            received.append(req)
            return "ok"

        await mw.awrap_tool_call(request, _handler)

        assert received, "handler was not called"
        assert received[0] is request
        assert received[0].tool_call["args"]["project_path"] == host_path
