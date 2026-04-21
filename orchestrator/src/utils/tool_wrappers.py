"""
tool_wrappers — MCP tool call safety-net utilities.

This module provides three defensive wrapper functions (compatible with
langchain-core >= 1.2.x and LangGraph >= 1.0.x, which require ``ainvoke``
to return ``ToolMessage`` objects when invoked via ``ToolNode``):

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

Internal architecture
---------------------
**Frozen dataclass contexts:** Each wrapper defines a frozen ``@dataclass``
(``_InjectCtx``, ``_GuardCtx``, ``_LogCtx``) that groups the per-tool
closure state previously captured via multiple default-argument parameters.
This pattern is more readable, enables IDE autocompletion, and makes it easy
to add state without changing the closure signature.

**``_patch_tool()`` helper:** LangChain tools extend Pydantic ``BaseModel``,
which validates ``__setattr__``.  All attribute monkeypatching in this module
is funnelled through :func:`_patch_tool`, the **only** function that calls
``object.__setattr__``.  This centralises the bypass for auditing and future
migration.

Design notes — :func:`inject_project_path`
-------------------------------------------
- **Idempotent:** A sentinel attribute ``_orig_ainvoke`` prevents wrapper
  stacking when the same tool objects are passed multiple times.
- Only ``ainvoke`` is monkeypatched; all other attributes remain untouched.
- Injection uses ``setdefault`` semantics: an explicitly-provided
  ``project_path`` is never overwritten.  ``cwd_path`` (IDE-only) is
  stripped — ``project_path`` takes precedence.
- ``ledger_detect_project`` is short-circuited with a synthetic response
  (no MCP round-trip) because ``project_path`` is always known.
- Both dict-style and plain-string input are handled gracefully.

Design notes — :func:`restrict_to_wp`
--------------------------------------
- **Idempotent:** A ``_wp_guard_ref`` sentinel prevents double-stacking.
  If inner wrappers were re-applied since the last call, the delegation
  target is updated to the fresh inner chain.
- Empty ``wp_id`` → no wrapping (stages without an active WP).
- **Read-only tools are exempt** (``_READ_ONLY_TOOLS``).
- Missing ``work_package_id`` → auto-injected with the active WP ID.
- Mismatched ``work_package_id`` → soft-fail (violations 1–2 return an
  error string); hard kill on violation 3+ (:class:`ValueError`).
- The strike counter (``_GuardCtx.counter``) is a ``list[int]`` shared
  across all tool closures; it resets on each :func:`restrict_to_wp` call.
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected.
- **Shared-tool-instance safe:** sentinels are overwritten on every call.

Design notes — :func:`log_tool_calls`
--------------------------------------
- **Idempotent:** A ``_log_wrapper_ref`` sentinel prevents double-stacking,
  mirroring the pattern in :func:`restrict_to_wp`.
- ``logger is None`` → no wrapping (unit tests, loggerless stages).
- Only ``tool.name`` and ``work_package_id`` are captured; the full
  argument payload is deliberately **excluded** (privacy constraint).
- Both flat-dict and ``{"args": {...}}`` ToolCall structures are inspected.
- Events use ``level: "DEBUG"`` for filtering.

Context
-------
Tests for this module live in ``orchestrator/tests/test_tool_wrappers.py``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from langchain_core.messages import ToolMessage

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
    "ledger_detect_project",  # also short-circuited by inject_project_path
    "ledger_list_projects",
    "ledger_help",
})


def _patch_tool(tool: Any, **attrs: Any) -> None:
    """Set attributes on a tool object, bypassing Pydantic's ``__setattr__``.

    LangChain tools extend Pydantic ``BaseModel`` which validates attribute
    assignment.  This helper centralises the ``object.__setattr__`` bypass
    so the pattern appears exactly once in the module and can be audited
    (or migrated) in a single place.
    """
    for name, value in attrs.items():
        object.__setattr__(tool, name, value)


# ---------------------------------------------------------------------------
# Frozen dataclass contexts — one per wrapper — group the per-tool closure
# state that was previously captured via multiple default-argument parameters.
# ---------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class _InjectCtx:
    """Per-tool closure state for :func:`inject_project_path`."""

    orig: Any
    project_path: str
    tool_name: str


@dataclass(frozen=True, slots=True)
class _GuardCtx:
    """Per-tool closure state for :func:`restrict_to_wp`."""

    orig: Any
    active_wp: str
    counter: list[int] = field(hash=False)
    max_soft: int
    tool_name: str


@dataclass(frozen=True, slots=True)
class _LogCtx:
    """Per-tool closure state for :func:`log_tool_calls`."""

    orig: Any
    tool_name: str
    stage: str
    wp_id: str
    logger: Any


def _make_tool_response(
    content: str,
    input: Any,
    tool_name: str,
    status: str = "error",
) -> ToolMessage | str:
    """Wrap *content* in a ``ToolMessage`` when running inside LangGraph's ToolNode.

    LangGraph >= 1.0.9 enforces ``isinstance(response, ToolMessage)`` on the
    return value of ``tool.ainvoke``.  Short-circuit return paths that bypass
    the normal ``BaseTool.ainvoke → _format_output`` chain must therefore
    produce a ``ToolMessage`` when a ``tool_call_id`` (input dict key ``"id"``)
    is present.

    When the input is a plain dict without ``"id"`` (unit tests, direct
    invocations), the raw string is returned for backward compatibility.
    """
    if isinstance(input, dict):
        tool_call_id = input.get("id")
        if tool_call_id is not None:
            return ToolMessage(
                content=content,
                tool_call_id=tool_call_id,
                name=tool_name,
                status=status,
            )
    return content


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
            _patch_tool(tool, _orig_ainvoke=tool.ainvoke)
        _original_ainvoke = tool._orig_ainvoke  # type: ignore[attr-defined]

        ctx = _InjectCtx(
            orig=_original_ainvoke,
            project_path=project_path,
            tool_name=tool.name,
        )

        async def _wrapped_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _InjectCtx = ctx,
            **kwargs: Any,
        ) -> Any:
            # Short-circuit: ledger_detect_project is an IDE-facing tool that
            # cross-references cwd_path against stored project roots.  In the
            # orchestrator, project_path is always known, so we return a
            # synthetic response immediately — no MCP round-trip needed.
            if _ctx.tool_name == "ledger_detect_project":
                slug = _ctx.project_path.rstrip("/").rsplit("/", 1)[-1]
                title = slug.replace("-", " ").replace("_", " ").title()
                payload = json.dumps({
                    "plan_path": _ctx.project_path,
                    "slug": slug,
                    "title": title,
                    "status": "active",
                    "note": "Short-circuited by orchestrator — project_path is already known.",
                })
                return _make_tool_response(payload, input, _ctx.tool_name, status="success")
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
                target.setdefault("project_path", _ctx.project_path)
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_wrapped_ainvoke)

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

    **Design note — PM stages and cross-WP calls:**
    Pipeline agent stages (Developer, QA, Reviewer, etc.) must never cross
    WP boundaries, so this guard is always correct for them.  The PM stage
    is an *orchestrating* role that may, in principle, need to inspect or
    manipulate a different WP than the one it was dispatched for.  The
    current architecture handles this correctly without relaxing the guard:
    PM stages complete their pipeline work on the active WP, then return
    WAIT.  The supervisor re-enters, queries ``ledger_get_next_action``,
    receives the next routing signal (e.g. ``ROUTE_PIPELINE_AGENT``), and
    dispatches a new stage invocation with the correct ``wp_id``.  Any
    cross-WP claim attempt *within* a PM stage is therefore a logic error in
    the agent, and the guard rejection is the correct outcome.

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
            _patch_tool(tool, _orig_ainvoke_wp=tool.ainvoke)
            _original_ainvoke_wp = tool.ainvoke

        ctx = _GuardCtx(
            orig=_original_ainvoke_wp,
            active_wp=wp_id,
            counter=_strikes,
            max_soft=_MAX_SOFT_FAILS,
            tool_name=tool_name,
        )

        async def _guarded_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _GuardCtx = ctx,
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
                    target["work_package_id"] = _ctx.active_wp
                elif call_wp_id != _ctx.active_wp:
                    _ctx.counter[0] += 1
                    if _ctx.counter[0] <= _ctx.max_soft:
                        # Soft-fail: return an error message so the agent can
                        # self-correct without aborting the stage.
                        error_msg = (
                            f"ERROR: Tool call targets work_package_id={call_wp_id!r} "
                            f"but the active work package is {_ctx.active_wp!r}. "
                            f"You MUST retry this call with "
                            f"work_package_id={_ctx.active_wp!r}. "
                            f"(violation {_ctx.counter[0]} of {_ctx.max_soft} "
                            f"allowed before hard abort)"
                        )
                        return _make_tool_response(error_msg, input, _ctx.tool_name)
                    # Hard kill — third+ violation; prevent infinite retry loops.
                    raise ValueError(
                        f"Tool call targets work_package_id={call_wp_id!r} but "
                        f"the active work package is {_ctx.active_wp!r}. "
                        "Refusing to forward this call to prevent cross-WP contamination."
                    )
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_guarded_ainvoke, _wp_guard_ref=_guarded_ainvoke)

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
            _patch_tool(tool, _orig_ainvoke_log=tool.ainvoke)
            _original_ainvoke_log = tool.ainvoke

        ctx = _LogCtx(
            orig=_original_ainvoke_log,
            tool_name=getattr(tool, "name", ""),
            stage=stage,
            wp_id=wp_id,
            logger=logger,
        )

        async def _logged_ainvoke(
            input: Any,
            *args: Any,
            _ctx: _LogCtx = ctx,
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

            _ctx.logger.stream_entry({
                "stage": _ctx.stage,
                "wp_id": _ctx.wp_id,
                "action": "tool_call",
                "tool_name": _ctx.tool_name,
                "tool_wp_id": tool_wp_id,
                "level": "DEBUG",
            })
            return await _ctx.orig(input, *args, **kwargs)

        _patch_tool(tool, ainvoke=_logged_ainvoke, _log_wrapper_ref=_logged_ainvoke)

    return tools

