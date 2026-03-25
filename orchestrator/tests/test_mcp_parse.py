"""
test_mcp_parse.py — Unit tests for src.utils.mcp_parse.parse_tool_response.

Covers every input shape the parser must handle:

1. List with a ``{"type": "text", "text": "<json>"}`` block
2. List without a ``type=text`` block (raw list returned)
3. JSON string (parsed to dict)
4. Non-JSON string (returned as-is)
5. ToolMessage-like object (has ``.content`` attribute)
6. None input
7. Direct dict input (returned as-is)

No external I/O or MCP server required — all tests run in < 1 ms.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from src.utils.mcp_parse import parse_tool_response

# ---------------------------------------------------------------------------
# Parametrized cases
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    # 1. List with a text block whose payload is valid JSON → parsed dict
    (
        [{"type": "text", "text": json.dumps({"action": "IMPLEMENT", "wp_id": "WP-001"})}],
        {"action": "IMPLEMENT", "wp_id": "WP-001"},
    ),
    # 2. List without any ``type=text`` block → raw list returned unchanged
    (
        [{"type": "image", "url": "https://example.com/img.png"}],
        [{"type": "image", "url": "https://example.com/img.png"}],
    ),
    # 3. JSON string → parsed dict
    (
        json.dumps({"status": "PASS", "pipelines": []}),
        {"status": "PASS", "pipelines": []},
    ),
    # 4. Non-JSON string → returned as-is
    (
        "not valid json {{{ }}",
        "not valid json {{{ }}",
    ),
    # 5a. ToolMessage-like: object with `.content` = JSON string → parsed dict
    # (tested separately below because MagicMock needs special setup)
    # 6. None → None
    (None, None),
    # 7. Direct dict → returned as-is
    (
        {"already": "parsed"},
        {"already": "parsed"},
    ),
    # Bonus: list with text block that is NOT valid JSON → text returned as string
    (
        [{"type": "text", "text": "plain non-json text"}],
        "plain non-json text",
    ),
    # Bonus: empty list → empty list returned
    ([], []),
])
def test_parse_tool_response_parametrized(raw, expected):
    """parse_tool_response must handle each raw input shape correctly."""
    result = parse_tool_response(raw)
    assert result == expected


# ---------------------------------------------------------------------------
# ToolMessage-like object (separate test — requires MagicMock)
# ---------------------------------------------------------------------------

def test_parse_tool_response_toolmessage_like_object():
    """
    Objects with a ``.content`` attribute (e.g. LangChain ToolMessage) must
    be unwrapped before parsing.  A JSON-string ``.content`` yields a dict.
    """
    msg = MagicMock(spec_set=["content"])  # only exposes .content
    msg.content = json.dumps({"unwrapped": True, "value": 42})

    result = parse_tool_response(msg)

    assert isinstance(result, dict)
    assert result == {"unwrapped": True, "value": 42}


def test_parse_tool_response_toolmessage_non_json_content():
    """
    ToolMessage-like object whose ``.content`` is a non-JSON string must
    return the raw string (not raise).
    """
    msg = MagicMock(spec_set=["content"])
    msg.content = "plain string content"

    result = parse_tool_response(msg)

    assert result == "plain string content"


def test_parse_tool_response_toolmessage_list_content():
    """
    ToolMessage-like object whose ``.content`` is a list of text blocks must
    be unwrapped and then processed as a list.
    """
    msg = MagicMock(spec_set=["content"])
    msg.content = [{"type": "text", "text": json.dumps({"key": "val"})}]

    result = parse_tool_response(msg)

    assert result == {"key": "val"}


# ---------------------------------------------------------------------------
# Edge-cases on the list path
# ---------------------------------------------------------------------------

def test_parse_tool_response_list_multiple_blocks_first_text_wins():
    """
    When a list has multiple blocks, the first ``type=text`` block is used;
    remaining blocks are ignored.
    """
    raw = [
        {"type": "image", "url": "ignored"},
        {"type": "text", "text": json.dumps({"found": "first-text"})},
        {"type": "text", "text": json.dumps({"found": "second-text"})},
    ]
    result = parse_tool_response(raw)
    assert result == {"found": "first-text"}


def test_parse_tool_response_direct_list_is_not_json():
    """
    A list that is not a content-block list (e.g. a bare Python list of strings)
    is returned as-is when no ``type=text`` block is found.
    """
    raw = ["alpha", "beta", "gamma"]
    result = parse_tool_response(raw)
    assert result == ["alpha", "beta", "gamma"]
