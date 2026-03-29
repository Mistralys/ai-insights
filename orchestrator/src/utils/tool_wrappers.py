"""
tool_wrappers — MCP tool call safety-net utilities.

This module provides three defensive wrapper functions:

:func:`inject_project_path`
    Auto-injects ``project_path`` into every MCP tool call when the argument is
    absent.  It acts as a **Layer 2 safety net**: even if an LLM-driven agent
    ignores the explicit prompt instructions that ask it to supply
    ``project_path``, this wrapper guarantees the argument reaches the MCP
    server.

:func:`restrict_to_wp`
    Guards against hallucinated cross-WP tool calls using a **soft-fail with
    strike counter**.  The first two cross-WP write attempts return a
    descriptive ``"ERROR: …"`` string to the agent (giving it a chance to
    self-correct); the third violation raises :class:`ValueError` (hard kill).
    This is a **Layer 3 safety net** that prevents a confused LLM from
    accidentally operating on a different work package.

:func:`log_tool_calls`
    Emits a ``tool_call`` JSONL event (via :class:`~src.utils.logging.WorkflowLogger`)
    before forwarding every ``ainvoke`` call to the underlying MCP tool.  Provides
    real-time visibility into which tools each pipeline stage is invoking and which
    work package each call targets, without logging argument payloads (privacy
    constraint).

Design notes — :func:`inject_project_path`
-------------------------------------------
- A sentinel attribute ``_orig_ainvoke`` is stored on the tool object the first
  time it is wrapped.  Subsequent calls to :func:`inject_project_path` on the
  same tool objects (e.g. because ``list(mcp_tools)`` is a shallow copy and the
  same tool instances are re-used across node invocations) always delegate to
  the *original* ``ainvoke``, making the function **idempotent** and preventing
  unbounded wrapper stacking.
- Only ``ainvoke`` is monkeypatched; all other attributes (``name``,
  ``description``, ``args_schema``, etc.) remain untouched so that tool
  discovery and schema introspection work as normal.
- Injection uses ``setdefault`` semantics: an explicitly-provided
  ``project_path`` is never overwritten.  If the LLM passes ``cwd_path``
  (following persona instructions meant for IDE agents), the wrapper
  strips it for efficiency — the MCP server now handles both gracefully
  (``project_path`` takes precedence), but stripping avoids sending
  redundant data.
- The wrapper handles both dict-style and plain-string input gracefully — if
  the input is not a dict no injection is attempted.

Design notes — :func:`restrict_to_wp`
--------------------------------------
- A ``_wp_guard_ref`` sentinel stores the current guard closure reference.
  On subsequent calls, if ``tool.ainvoke`` is the same guard (identity check
  via ``_wp_guard_ref``), ``_orig_ainvoke_wp`` is **reused unchanged** —
  preventing double-stacking in pure idempotent re-wrap scenarios.  If inner
  wrappers were re-applied since the last call (e.g. a fresh
  ``inject_project_path`` pass), ``tool.ainvoke is _prev`` is ``False``, so
  ``_orig_ainvoke_wp`` is updated to capture the fresh inner chain.  This
  ensures the guard always delegates to the *most recently applied* inner
  wrapper while closures never stack — only one guard layer exists at any
  time.
- If ``wp_id`` is the empty string the function returns the tools list unchanged
  (no wrapping).
- **Read-only tools are exempt.**  Tools whose names are in
  ``_READ_ONLY_TOOLS`` skip both WP-ID injection and cross-WP rejection.
  This allows agents to read other WPs for context (e.g. pipeline comments,
  handoff notes) while still preventing *writes* to a foreign WP.
- When a *write* tool call **omits** ``work_package_id``, the wrapper
  **injects** the active WP ID automatically.  This prevents the common LLM
  failure mode of forgetting to pass ``work_package_id`` and silently
  operating on the server's default WP instead of the intended one.
- When a *write* tool call **explicitly passes** a ``work_package_id`` that
  differs from the active WP, a **soft-fail** is applied: the first two
  violations return a descriptive ``"ERROR: …"`` string to the agent so it
  can self-correct by retrying with the correct WP ID.  On the third
  violation a :class:`ValueError` is raised (hard kill) to prevent infinite
  retry loops.  The **strike counter** is a ``list[int]`` created once per
  :func:`restrict_to_wp` call and shared across all tool closures via a
  default-argument capture.  The counter resets automatically when
  :func:`restrict_to_wp` is called again for a new stage.
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected,
  mirroring the pattern used by :func:`inject_project_path`.
- **Shared-tool-instance safe:** Tool objects are shared across all graph nodes.
  Each node re-wraps the tools for its own WP.  Because the sentinel is
  overwritten on every call, the guard always reflects the most recent WP.

Design notes — :func:`log_tool_calls`
--------------------------------------
- A ``_log_wrapper_ref`` sentinel stores the current logger closure reference.
  On subsequent calls, if ``tool.ainvoke`` is the same logger (identity check
  via ``_log_wrapper_ref``), ``_orig_ainvoke_log`` is **reused unchanged** —
  preventing double-stacking in pure idempotent re-wrap scenarios. If inner
  wrappers were re-applied since the last call, the identity check fails and
  ``_orig_ainvoke_log`` is updated to capture the fresh inner chain. This
  ensures the logger always delegates to the *most recently applied* inner
  wrapper while closures never stack.
- When *logger* is ``None`` (e.g. in unit tests or stages without an active
  logger), the function returns the tool list unchanged — no wrapping is applied.
- Only ``tool.name`` and the ``work_package_id`` argument (if present) are
  captured; the full argument payload is deliberately **excluded** to avoid
  logging sensitive plan content or large data.
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected when
  extracting ``work_package_id``, mirroring the pattern used by the other
  wrappers.
- The emitted event uses ``level: "DEBUG"`` so it can be filtered out of
  normal console output; the ``read-log.js`` script can filter by action type.

Context
-------
Tests for this module live in ``orchestrator/tests/test_tool_wrappers.py``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from src.utils.logging import WorkflowLogger

# MCP tools that perform read-only operations.  These are exempt from
# the cross-WP guard in :func:`restrict_to_wp` so that agents can read
# other work packages for context (pipeline comments, handoff notes, etc.)
# without triggering a stage-level error.
_READ_ONLY_TOOLS: frozenset[str] = frozenset({
    "ledger_get_work_package",
    "ledger_list_work_packages",
    "ledger_get_next_action",
    "ledger_get_project_status",
    "ledger_get_handoff_status",
    "ledger_detect_project",
    "ledger_list_projects",
    "ledger_help",
})


def inject_project_path(tools: list[Any], project_path: str) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to auto-inject ``project_path``.

    The function is **idempotent**: calling it multiple times on the same tool
    objects (e.g. because ``list(mcp_tools)`` produces a shallow copy) will
    not stack closures.  A sentinel attribute (``_orig_ainvoke``) is set on
    each tool on the first wrap; subsequent calls reuse that sentinel as the
    original so the wrapper chain never grows beyond one level.

    Parameters
    ----------
    tools:
        A list of LangChain ``BaseTool`` instances (typically MCP-backed
        ``StructuredTool`` objects obtained from
        :class:`~src.mcp_client.MCPToolkit`).
    project_path:
        The ledger project-directory path to inject when the tool call
        arguments do not already contain ``project_path``.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the wrapper.
        Mutation is in-place; the original list reference is also returned for
        convenience.  Repeated calls on already-wrapped tools are idempotent.
    """
    for tool in tools:
        # Retrieve (or establish) the true original ainvoke via sentinel.
        # This prevents wrapper stacking when the same tool object is passed
        # to inject_project_path more than once (shallow-copy scenario).
        if not hasattr(tool, "_orig_ainvoke"):
            object.__setattr__(tool, "_orig_ainvoke", tool.ainvoke)
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke,
            _proj: str = project_path,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                # LangGraph ToolNode passes a ToolCall dict with args nested
                # inside input["args"], while direct invocations pass a flat
                # dict of tool arguments.  Handle both structures.
                if "args" in input and isinstance(input["args"], dict):
                    # ToolCall structure: {"name": ..., "args": {...}, ...}
                    target = input["args"]
                else:
                    # Flat dict of tool arguments
                    target = input

                # In the orchestrator context we always know the exact
                # project_path, so cwd_path-based auto-detection is never
                # needed.  If the LLM agent followed persona instructions
                # meant for interactive IDE agents and passed cwd_path,
                # strip it — project_path takes precedence when both are
                # present, but removing it avoids unnecessary ambiguity.
                if "cwd_path" in target:
                    del target["cwd_path"]
                target.setdefault("project_path", _proj)
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _wrapped_ainvoke)

    return tools


def restrict_to_wp(tools: list[Any], wp_id: str) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to guard against cross-WP write calls.

    When a tool call includes a ``work_package_id`` argument that does not
    match *wp_id*, the guard applies a **soft-fail with strike counter**:

    * **Violations 1–2** — returns a descriptive ``"ERROR: …"`` string so the
      agent can self-correct without aborting the stage.
    * **Violation 3+** — raises :class:`ValueError` (hard kill) to prevent
      infinite retry loops.

    The strike counter is shared across *all* tools wrapped in a single call
    so any two cross-WP violations in the same stage trigger the hard kill.

    Tool calls that do not include ``work_package_id`` are passed through
    unmodified; the active WP ID is auto-injected instead.

    The function is **idempotent**: a sentinel attribute ``_orig_ainvoke_wp``
    prevents closure stacking when the same tool objects are wrapped more than
    once.

    Parameters
    ----------
    tools:
        A list of tool objects (typically already wrapped by
        :func:`inject_project_path`).
    wp_id:
        The active work-package identifier (e.g. ``"WP-001"``).
        When this is an **empty string**, the function returns *tools* unchanged
        so that stages without an active WP (e.g. synthesis) are not affected.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the guard
        wrapper.  Mutation is in-place; the original list reference is also
        returned for convenience.
    """
    if not wp_id:
        return tools

    # Shared strike counter for all tools in this restrict_to_wp invocation.
    # A single-element list acts as a mutable counter so each closure can
    # increment it without a ``nonlocal`` statement.  The counter resets
    # automatically when restrict_to_wp is called again for a new stage
    # (a fresh list is created on each call).
    _strikes: list[int] = [0]
    _MAX_SOFT_FAILS: int = 2

    for tool in tools:
        # Read-only tools are exempt from the guard — agents need to read
        # other WPs for context (pipeline comments, handoff notes, etc.).
        tool_name = getattr(tool, "name", "")
        if tool_name in _READ_ONLY_TOOLS:
            continue

        # If the current ainvoke is our own guard from a previous call
        # (identity check), reuse the saved delegation target (idempotent
        # double-call scenario).  Otherwise the inner layers were re-wrapped
        # since our last call — capture the fresh inner wrapper.
        _prev = getattr(tool, "_wp_guard_ref", None)
        if _prev is not None and tool.ainvoke is _prev:
            _original_ainvoke_wp = tool._orig_ainvoke_wp  # type: ignore[attr-defined]
        else:
            object.__setattr__(tool, "_orig_ainvoke_wp", tool.ainvoke)
            _original_ainvoke_wp = tool.ainvoke

        async def _guarded_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke_wp,
            _active_wp: str = wp_id,
            _counter: list[int] = _strikes,
            _max_soft: int = _MAX_SOFT_FAILS,
            **kwargs: Any,
        ) -> Any:
            if isinstance(input, dict):
                # Handle both flat-dict and ToolCall {"args": {...}} structures.
                if "args" in input and isinstance(input["args"], dict):
                    target = input["args"]
                else:
                    target = input

                call_wp_id = target.get("work_package_id")
                if call_wp_id is None:
                    # Inject the active WP ID when the agent omits it.  This
                    # prevents cross-WP contamination from forgotten parameters
                    # without raising an error — tools that don't use WP IDs
                    # will simply ignore the extra argument.
                    target["work_package_id"] = _active_wp
                elif call_wp_id != _active_wp:
                    _counter[0] += 1
                    if _counter[0] <= _max_soft:
                        # Soft-fail: return an error string so the agent can
                        # self-correct without aborting the stage.
                        return (
                            f"ERROR: Tool call targets work_package_id={call_wp_id!r} "
                            f"but the active work package is {_active_wp!r}. "
                            f"You MUST retry this call with work_package_id={_active_wp!r}. "
                            f"(violation {_counter[0]} of {_max_soft} allowed before hard abort)"
                        )
                    # Hard kill — third+ violation; prevent infinite retry loops.
                    raise ValueError(
                        f"Tool call targets work_package_id={call_wp_id!r} but "
                        f"the active work package is {_active_wp!r}. "
                        "Refusing to forward this call to prevent cross-WP contamination."
                    )
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _guarded_ainvoke)
        object.__setattr__(tool, "_wp_guard_ref", _guarded_ainvoke)

    return tools


def log_tool_calls(
    tools: list[Any],
    stage: str,
    wp_id: str,
    logger: WorkflowLogger | None,
) -> list[Any]:
    """Wrap each tool's ``ainvoke`` to emit a ``tool_call`` JSONL event.

    Before forwarding each call to the underlying MCP server, the wrapper
    emits a lightweight ``tool_call`` event via ``logger.stream_entry()``.
    The event records the current stage, the stage-level work-package ID,
    the tool name, and the ``work_package_id`` extracted from the call
    arguments — but **not** the full argument payload (privacy constraint).

    The function is **idempotent**: a sentinel attribute
    ``_orig_ainvoke_log`` prevents closure stacking when the same tool
    objects are wrapped more than once (e.g. across node re-invocations
    that reuse the same tool instances).

    When *logger* is ``None`` the function returns *tools* unchanged so
    that stages without a live :class:`~src.utils.logging.WorkflowLogger`
    (e.g. unit tests) are not affected.

    Parameters
    ----------
    tools:
        A list of tool objects (typically already wrapped by
        :func:`inject_project_path` and :func:`restrict_to_wp`).
    stage:
        The current pipeline stage name (e.g. ``"pm"``, ``"developer"``).
        Forwarded verbatim into the emitted event's ``stage`` field.
    wp_id:
        The active work-package identifier (e.g. ``"WP-001"``), or an
        empty string for stages without a targeted WP.  Forwarded into
        the event's ``wp_id`` field.
    logger:
        A live :class:`~src.utils.logging.WorkflowLogger` instance, or
        ``None``.  When ``None``, no wrapping is performed and the tool
        list is returned unchanged.

    Returns
    -------
    list[Any]
        The same list with each tool's ``ainvoke`` replaced by the logging
        wrapper.  Mutation is in-place; the original list reference is also
        returned for convenience.  Repeated calls on already-wrapped tools
        are idempotent.
    """
    if logger is None:
        return tools

    for tool in tools:
        # If the current ainvoke is our own log wrapper from a previous call
        # (identity check), reuse the saved delegation target.  Otherwise
        # the inner layers were re-wrapped — capture the fresh inner wrapper.
        _prev_log = getattr(tool, "_log_wrapper_ref", None)
        if _prev_log is not None and tool.ainvoke is _prev_log:
            _original_ainvoke_log = tool._orig_ainvoke_log  # type: ignore[attr-defined]
        else:
            object.__setattr__(tool, "_orig_ainvoke_log", tool.ainvoke)
            _original_ainvoke_log = tool.ainvoke

        _tool_name: str = getattr(tool, "name", "")

        async def _logged_ainvoke(
            input: Any,
            *args: Any,
            _orig: Any = _original_ainvoke_log,
            _name: str = _tool_name,
            _stage: str = stage,
            _stage_wp_id: str = wp_id,
            _log: Any = logger,
            **kwargs: Any,
        ) -> Any:
            # Extract work_package_id from the call arguments without
            # capturing the full argument payload (privacy constraint).
            # Handle both flat-dict and ToolCall {"args": {...}} structures.
            tool_wp_id: str = ""
            if isinstance(input, dict):
                if "args" in input and isinstance(input["args"], dict):
                    # ToolCall structure: {"name": ..., "args": {...}, ...}
                    tool_wp_id = input["args"].get("work_package_id", "") or ""
                else:
                    # Flat dict of tool arguments
                    tool_wp_id = input.get("work_package_id", "") or ""

            _log.stream_entry({
                "stage": _stage,
                "wp_id": _stage_wp_id,
                "action": "tool_call",
                "tool_name": _name,
                "tool_wp_id": tool_wp_id,
                "level": "DEBUG",
            })
            return await _orig(input, *args, **kwargs)

        object.__setattr__(tool, "ainvoke", _logged_ainvoke)
        object.__setattr__(tool, "_log_wrapper_ref", _logged_ainvoke)

    return tools

