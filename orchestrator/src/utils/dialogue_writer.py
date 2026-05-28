"""
dialogue_writer.py — Utilities for serialising agent dialogues to Markdown files.

.. note::
   **Manual-use only.**  This module is retained for scripted/manual inspection
   of agent message histories.  As of the streaming-dialogue rework (rework-1,
   2026-04-10) the automated pipeline no longer calls ``write_dialogue()``;
   chunk JSONL files produced by
   :class:`~src.utils.chunk_writer.ChunkWriter` are the sole durable output
   from each stage run.

Public API
----------
serialize_messages_to_markdown(messages, stage, wp_id, timestamp) -> str
    Convert a LangChain message list to a human-readable Markdown document.

write_dialogue(content, slug_dir, wp_id, stage) -> Path
    Persist *content* to ``{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md``,
    auto-incrementing the revision number *N* when prior revisions exist.

Supported message roles
-----------------------
The following LangChain message types are recognised by ``_msg_role()``:

* ``HumanMessage`` (``type="human"``) → **Human**
* ``AIMessage`` (``type="ai"``) → **Assistant**
* ``ToolMessage`` (``type="tool"``) → **Tool Result**
* ``SystemMessage`` (``type="system"``) → **System**
* Any other type falls back to a capitalised form of the type name.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.utils._revision import next_revision

# ---------------------------------------------------------------------------
# Message serialisation
# ---------------------------------------------------------------------------

def _msg_role(message: Any) -> str:
    """Return the canonical role string for *message*."""
    # LangChain message objects expose a ``type`` attribute (``"human"``,
    # ``"ai"``, ``"tool"``, etc.).  We fall back to class-name sniffing for
    # objects that only quack like messages.
    msg_type = getattr(message, "type", None) or type(message).__name__.lower()
    if msg_type in ("human", "humanmessage"):
        return "Human"
    if msg_type in ("ai", "aimessage"):
        return "Assistant"
    if msg_type in ("tool", "toolmessage"):
        return "Tool Result"
    if msg_type in ("system", "systemmessage"):
        return "System"
    return msg_type.replace("message", "").capitalize() or "Message"


def _render_content(content: Any) -> str:
    """Return *content* as a plain string suitable for Markdown body text.

    LangChain's Anthropic and OpenAI adapters can return ``AIMessage.content``
    as a **list of content blocks** rather than a plain string.  Each block is
    a dict with a ``"type"`` key (e.g. ``{"type": "text", "text": "…"}`` or
    ``{"type": "tool_use", …}``).  Only ``"text"`` blocks are rendered as plain
    text; all other block types (``"tool_use"``, ``"image"``, etc.) are
    serialised as compact JSON fences so no information is silently lost.

    Empty-string parts produced by content blocks are intentionally discarded
    (they would produce blank ``\\n\\n`` gaps in the Markdown output).
    """
    if isinstance(content, str):
        return content
    # Anthropic / OpenAI provider adapters may return a list of content blocks.
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                btype = block.get("type", "")
                if btype == "text":
                    parts.append(block.get("text", ""))
                else:
                    # Non-text blocks (tool_use, image, …) rendered as JSON.
                    parts.append(f"```json\n{json.dumps(block, indent=2)}\n```")
            else:
                parts.append(str(block))
        return "\n\n".join(p for p in parts if p)
    return str(content) if content is not None else ""


def _render_tool_calls(tool_calls: list[dict[str, Any]]) -> str:
    """Render *tool_calls* as fenced Markdown code blocks."""
    blocks: list[str] = []
    for tc in tool_calls:
        name = tc.get("name", "unknown_tool")
        args = tc.get("args", {})
        tc_id = tc.get("id", "")
        header = f"**Tool call:** `{name}`" + (f" (id: `{tc_id}`)" if tc_id else "")
        body = f"```json\n{json.dumps(args, indent=2)}\n```"
        blocks.append(f"{header}\n\n{body}")
    return "\n\n".join(blocks)


def _collect_usage(messages: Sequence[Any]) -> dict[str, int] | None:
    """
    Aggregate ``usage_metadata`` from all messages in *messages*.

    Returns a merged dict or ``None`` when no usage data is present.
    """
    totals: dict[str, int] = {}
    for msg in messages:
        meta = getattr(msg, "usage_metadata", None)
        if meta and isinstance(meta, dict):
            for key, value in meta.items():
                if isinstance(value, (int, float)):
                    totals[key] = totals.get(key, 0) + int(value)
    return totals if totals else None


def serialize_messages_to_markdown(
    messages: Sequence[Any],
    stage: str,
    wp_id: str,
    timestamp: str | None = None,
) -> str:
    """
    Serialise *messages* to a Markdown string.

    Parameters
    ----------
    messages:
        Sequence of LangChain message objects (HumanMessage, AIMessage,
        ToolMessage, …) or any objects with a ``type`` attribute.
    stage:
        Pipeline stage name (e.g. ``"developer"``).
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    timestamp:
        ISO 8601 timestamp string.  Defaults to the current UTC time when
        ``None``.

    Returns
    -------
    str
        A Markdown document with a header, per-message sections, and an
        optional token-usage footer.
    """
    if timestamp is None:
        timestamp = datetime.now(UTC).isoformat(timespec="seconds")

    lines: list[str] = [
        f"# Dialogue — {stage} / {wp_id}",
        "",
        "| Field | Value |",
        "| ----- | ----- |",
        f"| Stage | `{stage}` |",
        f"| WP ID | `{wp_id}` |",
        f"| Captured | {timestamp} |",
        "",
    ]

    if not messages:
        lines.append("*No messages recorded.*")
        return "\n".join(lines) + "\n"

    for idx, msg in enumerate(messages, start=1):
        role = _msg_role(msg)
        lines.append(f"## {role}")
        lines.append("")

        # Render tool calls for AI messages first.
        tool_calls: list[dict[str, Any]] = getattr(msg, "tool_calls", None) or []
        content_str = _render_content(getattr(msg, "content", ""))

        if content_str:
            lines.append(content_str)
            lines.append("")

        if tool_calls:
            lines.append(_render_tool_calls(tool_calls))
            lines.append("")

    # Token-usage footer.
    usage = _collect_usage(messages)
    if usage:
        lines.append("---")
        lines.append("")
        lines.append("## Token Usage")
        lines.append("")
        lines.append("| Metric | Count |")
        lines.append("| ------ | ----- |")
        for key, value in sorted(usage.items()):
            lines.append(f"| {key.replace('_', ' ').title()} | {value} |")
        lines.append("")

    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# File persistence
# ---------------------------------------------------------------------------

def write_dialogue(
    content: str,
    slug_dir: Path,
    wp_id: str,
    stage: str,
) -> Path:
    """
    Write *content* to ``{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md``.

    The revision number *N* is determined by globbing existing
    ``{wp_id}-{stage}-r*.md`` files inside ``{slug_dir}/orchestrator/dialogues/``.
    The first call writes ``r0``; subsequent calls for the same
    ``wp_id``/``stage`` pair increment the revision.

    .. note:: Cross-language coupling
        The subdirectory path ``orchestrator/dialogues`` is intentionally kept
        in sync with the MCP server's ``DIALOGUES_DIR`` constant defined in
        ``mcp-server/src/utils/constants.ts``.  If this value ever needs to
        change, both files must be updated together.

    Parameters
    ----------
    content:
        Markdown string to write.
    slug_dir:
        Root directory for the project's ledger storage
        (e.g. ``{workspace_root}/mcp-server/storage/ledger/{repo_name}/{slug}``).  
        *repo_name* is derived from the fourth ancestor of the plan directory;
        it defaults to ``'unknown'`` when the path is too short.
    wp_id:
        Work-package identifier (e.g. ``"WP-001"``).
    stage:
        Pipeline stage name (e.g. ``"developer"``).

    Returns
    -------
    Path
        Absolute path to the file that was written.
    """
    dialogues_dir = slug_dir / "orchestrator" / "dialogues"
    dialogues_dir.mkdir(parents=True, exist_ok=True)

    # Determine next revision number.
    revision = next_revision(dialogues_dir, wp_id, stage, ".md")

    filename = f"{wp_id}-{stage}-r{revision}.md"
    dest = dialogues_dir / filename
    dest.write_text(content, encoding="utf-8")
    return dest
