"""
mcp_client.py — MCP toolkit setup via langchain-mcp-adapters.

Provides :class:`MCPToolkit`, an async context manager that:

- Starts the compiled MCP server subprocess over STDIO transport.
- Exposes :meth:`MCPToolkit.get_tools` returning LangChain Tool objects for
  all 19 ledger tools.
- Runs a health check (``ledger_help`` invocation) immediately after startup
  to confirm MCP server connectivity.
- Cleans up the subprocess on both normal exit and unexpected crashes via an
  ``atexit`` handler and ``__aexit__``.

Typical one-shot usage (lifecycle managed internally)::

    tools = await get_mcp_tools(cfg)

Advanced usage — manage lifecycle explicitly when tools must remain alive
across multiple calls::

    async with MCPToolkit.from_config(cfg) as toolkit:
        tools = toolkit.get_tools()
        # … perform multiple tool invocations …

    # Or construct directly:
    toolkit = MCPToolkit(mcp_server_cmd=["node", "/path/to/dist/index.js"])
    async with toolkit:
        tools = toolkit.get_tools()

.. note::
    The :class:`~src.config.Config` import is gated behind
    ``TYPE_CHECKING`` to avoid a circular import at module load time.
    The actual ``Config`` object is only needed at runtime in
    :meth:`MCPToolkit.from_config`, which receives it as a parameter.
"""

from __future__ import annotations

import atexit
import asyncio
import logging
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .config import Config

log = logging.getLogger(__name__)

_SERVER_KEY = "ledger"


class MCPToolkit:
    """
    Async context manager that manages the MCP server lifecycle and exposes
    LangChain Tool objects for all ledger MCP tools.

    Parameters
    ----------
    mcp_server_cmd:
        Command list used to launch the MCP server subprocess
        (e.g. ``["node", "/path/to/dist/index.js"]``).
    """

    def __init__(self, mcp_server_cmd: list[str]) -> None:
        self._cmd = mcp_server_cmd
        self._client: Any = None
        self._tools: list | None = None

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def from_config(cls, config: "Config") -> "MCPToolkit":
        """Construct an :class:`MCPToolkit` from a :class:`~src.config.Config`."""
        return cls(mcp_server_cmd=config.mcp_server_cmd)

    # ------------------------------------------------------------------
    # Async context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "MCPToolkit":
        from langchain_mcp_adapters.client import MultiServerMCPClient  # type: ignore[import]

        cmd0, *args = self._cmd
        self._client = MultiServerMCPClient(
            {
                _SERVER_KEY: {
                    "command": cmd0,
                    "args": args,
                    "transport": "stdio",
                }
            }
        )
        await self._client.__aenter__()

        # Cache tools immediately so get_tools() is synchronous.
        self._tools = self._client.get_tools()
        log.info("MCP server started; %d tools loaded.", len(self._tools))

        # Register atexit cleanup so the subprocess is killed even on crashes.
        atexit.register(self._sync_cleanup)

        # Health check — invoke ledger_help to confirm the server is responsive.
        await self._health_check()

        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        atexit.unregister(self._sync_cleanup)
        if self._client is not None:
            try:
                await self._client.__aexit__(exc_type, exc, tb)
            except Exception:  # noqa: BLE001
                log.warning("Error shutting down MCP client.", exc_info=True)
        self._client = None
        self._tools = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_tools(self) -> list:
        """
        Return the list of LangChain Tool objects for all MCP ledger tools.

        Must be called inside the async context (after ``__aenter__``).

        Raises
        ------
        RuntimeError
            If called before entering the async context manager.
        """
        if self._tools is None:
            raise RuntimeError(
                "MCPToolkit.get_tools() called outside of async context. "
                "Use 'async with MCPToolkit(...) as toolkit:' first."
            )
        return self._tools

    @property
    def is_connected(self) -> bool:
        """``True`` if the MCP client context is active."""
        return self._client is not None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _health_check(self) -> None:
        """Invoke ``ledger_help`` to verify the MCP server is responsive."""
        tools_by_name = {t.name: t for t in (self._tools or [])}
        help_tool = tools_by_name.get("ledger_help")
        if help_tool is None:
            raise RuntimeError(
                "Health check failed: 'ledger_help' tool not found in MCP tool list. "
                f"Available tools: {sorted(tools_by_name)}"
            )
        try:
            result = await help_tool.ainvoke({})
            log.debug("MCP health check passed: %s", str(result)[:300])
        except Exception as exc:
            raise RuntimeError(
                f"MCP server health check failed: {exc}"
            ) from exc

    def _sync_cleanup(self) -> None:
        """Best-effort synchronous cleanup registered via :mod:`atexit`."""
        if self._client is None:
            return
        try:
            # TODO(WP-007): Replace asyncio.get_event_loop() with
            # asyncio.get_running_loop() / asyncio.new_event_loop() fallback
            # to silence DeprecationWarning in Python 3.12+ when no loop is
            # running at atexit time.  Low-risk; errors are suppressed below.
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Schedule cleanup as a fire-and-forget task.
                loop.create_task(self._client.__aexit__(None, None, None))
            else:
                loop.run_until_complete(
                    self._client.__aexit__(None, None, None)
                )
        except Exception:  # noqa: BLE001
            pass  # Best-effort; suppress all errors in atexit handlers.


# ---------------------------------------------------------------------------
# Convenience helper
# ---------------------------------------------------------------------------

async def get_mcp_tools(config: "Config") -> list:
    """
    Convenience coroutine: start the MCP toolkit, run the health check, and
    return the tool list.

    .. note::
        The MCP server subprocess is started and **stopped** within this call
        (via the async context manager).  This helper is intended for
        one-shot tool-list retrieval in simple scripts where lifecycle
        management is not required.

    Parameters
    ----------
    config:
        Application config (provides ``mcp_server_cmd``).

    Returns
    -------
    list
        LangChain Tool objects for all 19 ledger MCP tools.
    """
    async with MCPToolkit.from_config(config) as toolkit:
        return toolkit.get_tools()
