"""
path_middleware — Deep Agents tool-call middleware for Windows path normalization.

On Windows, Deep Agents' ``validate_path()`` unconditionally rejects paths that
match ``^[a-zA-Z]:`` before ``_resolve_path()`` can translate them to virtual
``/``-rooted paths.  This middleware intercepts every tool call and rewrites
Windows drive-letter paths to their virtual equivalents *before* validation runs.

:class:`PathNormalizationMiddleware`
    Scans all string arguments of every tool call.  Any value whose normalized
    form starts with the known ``root_dir`` prefix (case-insensitive) is rewritten
    to a ``/``-rooted virtual path.  Values that do not match are passed through
    unchanged.

On macOS / Linux ``root_dir`` never starts with ``[a-zA-Z]:`` so the middleware
is an inert no-op — every ``awrap_tool_call`` call delegates directly to the
handler without inspecting arguments.

Designed to work in tandem with ``LocalShellBackend(virtual_mode=True)``:
- ``virtual_mode=True`` handles *resolution* of ``/``-rooted paths on Windows.
- This middleware handles *validation* rejection of Windows drive-letter paths.

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
    """Rewrite Windows drive-letter paths in tool call arguments to virtual paths.

    Parameters
    ----------
    root_dir:
        The project root directory as passed to ``LocalShellBackend(root_dir=…)``.
        Used as the prefix to strip when computing the virtual path.

    Behaviour
    ---------
    - When ``root_dir`` starts with a Windows drive letter the middleware is
      *active*: it rewrites matching paths in ``awrap_tool_call``.
    - Otherwise (POSIX ``root_dir``) the middleware is *inactive*: it is a
      zero-cost pass-through.
    - Only string values whose normalized form case-insensitively matches the
      ``root_dir`` prefix are rewritten.  Paths outside the project root are
      left unchanged.
    - Backslash separators in the input are normalized to forward slashes before
      comparison and in the output.
    """

    def __init__(self, root_dir: str) -> None:
        self._root: str = root_dir.replace("\\", "/")
        # Active only when root_dir is a Windows absolute path.
        self._active: bool = bool(_WIN_PATH_RE.match(root_dir))

    def _to_virtual(self, value: str) -> str:
        """Convert a Windows path rooted at ``_root`` to a ``/``-rooted virtual path.

        Parameters
        ----------
        value:
            A string that has already been confirmed to match ``^[a-zA-Z]:``.

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

    def _rewrite_args(self, args: dict[str, Any]) -> dict[str, Any] | None:
        """Scan *args* for Windows paths and rewrite matching ones.

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
            if isinstance(val, str) and _WIN_PATH_RE.match(val):
                rewritten = self._to_virtual(val)
                if rewritten != val:
                    changed[key] = rewritten

        return {**args, **changed} if changed else None

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[ToolMessage | Command[Any]]],
    ) -> ToolMessage | Command[Any]:
        """Intercept a tool call, rewrite Windows paths, and delegate to *handler*.

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
        args: dict[str, Any] = request.tool_call.get("args", {})
        modified = self._rewrite_args(args)
        if modified is not None:
            new_tool_call = {**request.tool_call, "args": modified}
            request = request.override(tool_call=new_tool_call)
        return await handler(request)
