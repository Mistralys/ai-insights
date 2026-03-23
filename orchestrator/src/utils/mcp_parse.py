"""
mcp_parse — Shared MCP tool response parser.

Handles the multiple response formats returned by
``langchain-mcp-adapters`` when invoking MCP tools, providing a
unified parsed output for callers.

Formats handled
---------------
- **List of content blocks** (``langchain-mcp-adapters`` 0.1.0 format):
  ``[{"type": "text", "text": "<json-string>"}]``
- **JSON string**: parsed via ``json.loads``; falls back to raw string if
  not valid JSON.
- **ToolMessage-like** (LangChain): object with a ``.content`` attribute
  is unwrapped before applying the above rules.
- **Direct dict** or any other object: returned as-is.

This logic was originally inlined in ``supervisor.py``'s ``_call_tool``.
Extracting it here allows both the supervisor and the node factory to
share the same response-parsing behaviour without duplication.
"""

from __future__ import annotations

import json
from typing import Any


def parse_tool_response(raw: Any) -> dict | list | str | None:
    """
    Parse an MCP tool response into a usable Python object.

    Parameters
    ----------
    raw:
        The raw value returned by ``tool.ainvoke()``.

    Returns
    -------
    dict | list | str | None
        - ``dict`` — successfully JSON-parsed object.
        - ``list``  — raw list when no parseable text block found.
        - ``str``   — raw string when JSON parsing fails.
        - ``None``  — when *raw* is ``None``.
    """
    if raw is None:
        return None

    # Unwrap ToolMessage-like objects (LangChain ``ToolMessage`` etc.)
    # that expose their payload via a ``.content`` attribute.
    if hasattr(raw, "content") and not isinstance(raw, (dict, list)):
        raw = raw.content

    # langchain-mcp-adapters 0.1.0 returns a list of content objects:
    # [{"type": "text", "text": "<json-string>"}]
    if isinstance(raw, list):
        for block in raw:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block["text"]
                try:
                    return json.loads(text)
                except json.JSONDecodeError:
                    return text
        # No parseable text block found; return the raw list.
        return raw

    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw

    # Direct dict or any other object.
    return raw
