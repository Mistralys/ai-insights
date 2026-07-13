"""
path_middleware — Deep Agents tool-call middleware for cross-platform path normalization.

Deep Agents' ``validate_path()`` unconditionally rejects Windows drive-letter paths
(``^[a-zA-Z]:``) before ``_resolve_path()`` can translate them to virtual ``/``-rooted
paths.  On all platforms, agents may receive absolute host paths in their context (e.g.
via ``project_path`` variables) and pass them directly as tool arguments.  This middleware
intercepts every tool call and rewrites absolute host paths to their virtual equivalents
*before* validation runs.

:class:`PathNormalizationMiddleware`
    Scans all string arguments of every tool call.  Any value whose normalized form
    starts with the known ``root_dir`` prefix (case-insensitive) is rewritten to a
    ``/``-rooted virtual path.  Values that do not match are passed through unchanged.

    MCP tools must receive absolute host paths (they call the MCP server directly and
    have no concept of virtual paths).  Pass their names via the ``skip_tools`` parameter
    to exempt them from rewriting.  In ``create_stage_node`` this set is derived
    dynamically from the ``mcp_tools`` objects — every MCP tool, present and future, is
    excluded by construction.

Active on all platforms when ``root_dir`` is a non-trivial absolute path:
- **Windows**: ``root_dir`` starts with a drive letter (e.g. ``C:``).
- **macOS / Linux**: ``root_dir`` starts with ``/`` and has length > 1.
- **Inactive**: ``root_dir`` is empty or equals bare ``/`` (would rewrite all virtual paths).

Designed to work in tandem with ``LocalShellBackend(virtual_mode=True)``:
- ``virtual_mode=True`` handles *resolution* of ``/``-rooted paths on all platforms.
- This middleware handles *validation* rejection of absolute host paths.

Context
-------
Tests live in ``orchestrator/tests/test_path_middleware.py``.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from langchain.agents.middleware.types import AgentMiddleware

if TYPE_CHECKING:
    from langchain.agents.middleware.types import ToolCallRequest
    from langchain_core.messages import ToolMessage
    from langgraph.types import Command

# Matches any string beginning with a Windows drive letter (e.g. ``C:``, ``f:``).
_WIN_PATH_RE: re.Pattern[str] = re.compile(r"^[a-zA-Z]:")


class PathNormalizationMiddleware(AgentMiddleware):
    """Rewrite absolute host paths in tool call arguments to virtual ``/``-rooted paths.

    Parameters
    ----------
    root_dir:
        The project root directory as passed to ``LocalShellBackend(root_dir=…)``.
        Used as the prefix to strip when computing the virtual path.
    skip_tools:
        An optional frozenset of tool names that must be exempted from path
        rewriting.  When a tool call's name appears in this set, the request is
        forwarded to the handler unchanged.  Pass the names of all MCP tools here
        (derived from ``mcp_tools`` in ``create_stage_node``) because MCP tools
        call the MCP server directly and require absolute host paths.  Defaults to
        ``frozenset()`` (no tools skipped) to preserve backward compatibility.

    Behaviour
    ---------
    - When ``root_dir`` is any non-trivial absolute path the middleware is *active*:
      it rewrites matching paths in ``awrap_tool_call``.  This covers both Windows
      drive-letter roots (e.g. ``C:\\project``) and POSIX roots (e.g.
      ``/Users/dev/project``).
    - When ``root_dir`` is empty or equals bare ``/`` the middleware is *inactive*:
      it is a zero-cost pass-through.  Bare ``/`` is excluded because activating
      on it would rewrite every virtual ``/``-rooted path.
    - Only string values whose normalized form case-insensitively starts with the
      ``root_dir`` prefix are rewritten.  Paths outside the project root and
      virtual ``/``-rooted paths that do not match the full prefix are left
      unchanged.
    - Backslash separators in the input are normalized to forward slashes before
      comparison and in the output.
    - Tools listed in ``skip_tools`` are always forwarded unchanged, regardless of
      whether ``_active`` is ``True`` or ``False``.
    """

    def __init__(self, root_dir: str, *, skip_tools: frozenset[str] = frozenset()) -> None:
        self._root: str = root_dir.replace("\\", "/")
        # Active when root_dir is any absolute path (Windows drive letter or POSIX).
        # Bare "/" is excluded: it would rewrite every virtual path.
        self._active: bool = bool(
            _WIN_PATH_RE.match(root_dir)
            or (root_dir.startswith("/") and len(root_dir) > 1)
        )
        # Tool names whose arguments must not be rewritten (e.g. MCP tools that
        # require absolute host paths rather than virtual /‑rooted paths).
        self._skip_tools: frozenset[str] = skip_tools

    def _to_virtual(self, value: str) -> str:
        """Convert an absolute host path rooted at ``_root`` to a ``/``-rooted virtual path.

        Works for both Windows drive-letter paths and POSIX absolute paths.

        Parameters
        ----------
        value:
            A string that has been confirmed as a rewritable absolute path.

        Returns
        -------
        str
            The virtual path (e.g. ``/src/file.ts``), or *value* unchanged when
            it does not start with the known ``root_dir`` prefix.
        """
        norm = value.replace("\\", "/")
        if norm.lower().startswith(self._root.lower()):
            stripped = norm[len(self._root):]
            # Remove any leading separator that was part of the prefix boundary.
            if stripped.startswith("/"):
                stripped = stripped[1:]
            return "/" + stripped if stripped else "/"
        return value

    def _is_rewritable(self, value: str) -> bool:
        """Return ``True`` when *value* looks like an absolute host path matching ``root_dir``.

        Virtual ``/``-rooted paths that do not start with the full ``root_dir`` prefix
        (e.g. ``/src/file.ts`` when root is ``/Users/dev/project``) are **not** rewritten.
        """
        if _WIN_PATH_RE.match(value):
            return True
        # POSIX absolute path: only rewrite if it matches the root prefix.
        norm = value.replace("\\", "/")
        return norm.startswith("/") and norm.lower().startswith(self._root.lower())

    def _rewrite_args(self, args: dict[str, Any]) -> dict[str, Any] | None:
        """Scan *args* for absolute host paths and rewrite matching ones.

        Parameters
        ----------
        args:
            The ``tool_call["args"]`` dict from the incoming tool call request.

        Returns
        -------
        dict or None
            A new dict with rewritten values when at least one argument was
            changed, or ``None`` when no changes were needed (fast path for
            callers that test the return value before creating a new request).
        """
        if not self._active:
            return None

        changed: dict[str, Any] = {}
        for key, val in args.items():
            if isinstance(val, str) and self._is_rewritable(val):
                rewritten = self._to_virtual(val)
                if rewritten != val:
                    changed[key] = rewritten

        return {**args, **changed} if changed else None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        """Intercept a tool call, rewrite absolute host paths, and delegate to *handler*.

        Parameters
        ----------
        request:
            Incoming tool call request.  ``request.tool_call`` is a dict with
            ``name``, ``args``, and ``id`` keys (standard LangChain ToolCall).
        handler:
            The next callable in the middleware chain; ultimately invokes the
            tool function.

        Returns
        -------
        ToolMessage or Command
            The result returned by *handler*.
        """
        # Short-circuit for MCP tools and any other explicitly excluded tools:
        # they require absolute host paths and must not be rewritten.
        if self._skip_tools and request.tool_call.get("name") in self._skip_tools:
            return await handler(request)

        args: dict[str, Any] = request.tool_call.get("args", {})
        modified = self._rewrite_args(args)
        if modified is not None:
            new_tool_call = {**request.tool_call, "args": modified}
            request = request.override(tool_call=new_tool_call)
        return await handler(request)
