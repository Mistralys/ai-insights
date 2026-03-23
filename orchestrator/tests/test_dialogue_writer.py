"""
test_dialogue_writer.py — Unit tests for orchestrator/src/utils/dialogue_writer.py.

All filesystem operations use pytest's ``tmp_path`` fixture; no real files are
created outside the temporary directory.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from langchain_core.messages import SystemMessage

from src.utils.dialogue_writer import _msg_role, serialize_messages_to_markdown, write_dialogue


# ---------------------------------------------------------------------------
# Minimal message stubs (no LangChain dependency required for unit tests)
# ---------------------------------------------------------------------------

def _human(content: str) -> Any:
    return SimpleNamespace(type="human", content=content, tool_calls=None, usage_metadata=None)


def _ai(content: str, tool_calls: list | None = None, usage: dict | None = None) -> Any:
    return SimpleNamespace(
        type="ai",
        content=content,
        tool_calls=tool_calls or [],
        usage_metadata=usage,
    )


def _tool(content: str, tool_call_id: str = "tc-1") -> Any:
    return SimpleNamespace(
        type="tool",
        content=content,
        tool_calls=None,
        tool_call_id=tool_call_id,
        usage_metadata=None,
    )


# ---------------------------------------------------------------------------
# serialize_messages_to_markdown
# ---------------------------------------------------------------------------

class TestSerializeHeader:
    """Document header is always present regardless of message content."""

    def test_header_contains_stage(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "developer" in md

    def test_header_contains_wp_id(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "WP-001" in md

    def test_header_contains_custom_timestamp(self):
        ts = "2026-01-15T10:00:00+00:00"
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001", timestamp=ts)
        assert ts in md

    def test_header_auto_timestamp_when_none(self):
        md = serialize_messages_to_markdown([], stage="qa", wp_id="WP-002")
        # A UTC ISO timestamp contains "T" and ends with "+00:00" or "Z".
        assert "T" in md  # rough sanity — there is some ISO-looking timestamp

    def test_title_line_format(self):
        md = serialize_messages_to_markdown([], stage="reviewer", wp_id="WP-003")
        assert "# Dialogue" in md


class TestSerializeEmptyMessages:
    """Empty message lists must not raise and must produce a valid document."""

    def test_no_exception(self):
        serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")

    def test_returns_string(self):
        result = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert isinstance(result, str)

    def test_minimal_placeholder_present(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "No messages" in md or "no messages" in md.lower()


class TestSerializeHumanMessage:
    """Human messages appear under ## Human."""

    def test_human_section_header(self):
        msgs = [_human("Hello, agent.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Human" in md

    def test_human_content_preserved(self):
        msgs = [_human("Please implement the feature.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Please implement the feature." in md

    def test_multi_paragraph_content(self):
        text = "Paragraph one.\n\nParagraph two."
        msgs = [_human(text)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Paragraph one." in md
        assert "Paragraph two." in md


class TestSerializeAIMessage:
    """AI messages appear under ## Assistant."""

    def test_assistant_section_header(self):
        msgs = [_ai("I will implement the feature.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Assistant" in md

    def test_ai_content_preserved(self):
        msgs = [_ai("Implementation complete.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Implementation complete." in md

    def test_tool_call_rendered_as_fenced_block(self):
        tc = [{"name": "read_file", "args": {"path": "/foo/bar.py"}, "id": "tc-abc"}]
        msgs = [_ai("Let me read the file.", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "read_file" in md
        assert "```" in md
        assert "/foo/bar.py" in md

    def test_tool_call_name_highlighted(self):
        tc = [{"name": "write_file", "args": {}, "id": "tc-1"}]
        msgs = [_ai("", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "write_file" in md

    def test_multiple_tool_calls_all_rendered(self):
        tc = [
            {"name": "tool_a", "args": {"x": 1}, "id": "tc-1"},
            {"name": "tool_b", "args": {"y": 2}, "id": "tc-2"},
        ]
        msgs = [_ai("Using two tools.", tool_calls=tc)]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "tool_a" in md
        assert "tool_b" in md


class TestSerializeToolMessage:
    """Tool messages appear under ## Tool Result."""

    def test_tool_result_section_header(self):
        msgs = [_tool("File content here.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Tool Result" in md

    def test_tool_content_preserved(self):
        msgs = [_tool("The answer is 42.")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "The answer is 42." in md


class TestSerializeMultipleMessages:
    """Multiple messages are all rendered in order."""

    def test_all_roles_present(self):
        msgs = [
            _human("Do the thing."),
            _ai("Calling tool.", tool_calls=[{"name": "x", "args": {}, "id": "tc-1"}]),
            _tool("Tool returned value."),
            _ai("Done."),
        ]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "## Human" in md
        assert "## Assistant" in md
        assert "## Tool Result" in md

    def test_ordering_preserved(self):
        msgs = [_human("First"), _ai("Second"), _tool("Third")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        pos_human = md.index("## Human")
        pos_ai = md.index("## Assistant")
        pos_tool = md.index("## Tool Result")
        assert pos_human < pos_ai < pos_tool


class TestSerializeUsageMetadata:
    """Aggregate token-usage table is appended when usage_metadata is present."""

    def test_usage_section_present_when_metadata_available(self):
        msgs = [_ai("Done.", usage={"input_tokens": 100, "output_tokens": 50})]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Token Usage" in md

    def test_usage_counts_appear_in_output(self):
        msgs = [_ai("Done.", usage={"input_tokens": 123, "output_tokens": 456})]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "123" in md
        assert "456" in md

    def test_usage_section_absent_when_no_metadata(self):
        msgs = [_human("Hello"), _ai("Hi")]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "Token Usage" not in md

    def test_usage_aggregated_across_messages(self):
        msgs = [
            _ai("First.", usage={"input_tokens": 10, "output_tokens": 20}),
            _ai("Second.", usage={"input_tokens": 5, "output_tokens": 15}),
        ]
        md = serialize_messages_to_markdown(msgs, stage="developer", wp_id="WP-001")
        assert "15" in md  # 10 + 5
        assert "35" in md  # 20 + 15

    def test_usage_section_absent_for_empty_messages(self):
        md = serialize_messages_to_markdown([], stage="developer", wp_id="WP-001")
        assert "Token Usage" not in md


# ---------------------------------------------------------------------------
# write_dialogue
# ---------------------------------------------------------------------------

class TestWriteDialogueCreatesDirectory:
    """The dialogues/ subdirectory is created when absent."""

    def test_creates_dialogues_dir(self, tmp_path: Path):
        write_dialogue("# Hello", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert (tmp_path / "dialogues").is_dir()

    def test_no_error_when_dir_already_exists(self, tmp_path: Path):
        (tmp_path / "dialogues").mkdir()
        write_dialogue("# Hello", slug_dir=tmp_path, wp_id="WP-001", stage="developer")


class TestWriteDialogueRevisionNumbers:
    """Revision counter starts at 0 and increments on each call."""

    def test_first_file_is_r0(self, tmp_path: Path):
        path = write_dialogue("content", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.name == "WP-001-developer-r0.md"

    def test_second_call_is_r1(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path2 = write_dialogue("v2", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path2.name == "WP-001-developer-r1.md"

    def test_third_call_is_r2(self, tmp_path: Path):
        for _ in range(2):
            write_dialogue("v", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path3 = write_dialogue("v3", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path3.name == "WP-001-developer-r2.md"

    def test_different_stage_starts_at_r0(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path = write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="qa")
        assert path.name == "WP-001-qa-r0.md"

    def test_different_wp_id_starts_at_r0(self, tmp_path: Path):
        write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        path = write_dialogue("v1", slug_dir=tmp_path, wp_id="WP-002", stage="developer")
        assert path.name == "WP-002-developer-r0.md"


class TestWriteDialogueContent:
    """Written file contains exactly the provided content."""

    def test_content_written_correctly(self, tmp_path: Path):
        content = "# My Dialogue\n\nHello world.\n"
        path = write_dialogue(content, slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.read_text(encoding="utf-8") == content

    def test_empty_content_written(self, tmp_path: Path):
        path = write_dialogue("", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert path.read_text(encoding="utf-8") == ""


class TestWriteDialogueReturnValue:
    """write_dialogue() returns the Path of the written file."""

    def test_returns_path_object(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert isinstance(result, Path)

    def test_returned_path_exists(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert result.exists()

    def test_returned_path_is_inside_dialogues_dir(self, tmp_path: Path):
        result = write_dialogue("x", slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        assert result.parent == tmp_path / "dialogues"


class TestWriteDialogueNoSideEffects:
    """Files are only created inside tmp_path — not in the working directory."""

    def test_no_dialogues_dir_in_cwd(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.chdir(tmp_path)
        separate_dir = tmp_path / "project"
        separate_dir.mkdir()
        write_dialogue("x", slug_dir=separate_dir, wp_id="WP-001", stage="developer")
        # The CWD (tmp_path) should not have a dialogues/ dir.
        assert not (tmp_path / "dialogues").exists()
        # Only the project dir's dialogues subdir should exist.
        assert (separate_dir / "dialogues").exists()


# ---------------------------------------------------------------------------
# _msg_role helper — SystemMessage coverage (WP-005)
# ---------------------------------------------------------------------------

class TestMsgRoleSystem:
    """_msg_role() correctly identifies a SystemMessage and returns 'System'."""

    def test_system_message_returns_system(self):
        msg = SystemMessage(content="You are a helpful assistant.")
        assert _msg_role(msg) == "System"


# ---------------------------------------------------------------------------
# Round-trip: serialize → write → read back
# ---------------------------------------------------------------------------

class TestRoundTrip:
    """Ensure the serialiser output can be written and read back intact."""

    def test_round_trip(self, tmp_path: Path):
        msgs = [
            _human("Implement the feature."),
            _ai("Done.", usage={"input_tokens": 10, "output_tokens": 5}),
        ]
        content = serialize_messages_to_markdown(
            msgs,
            stage="developer",
            wp_id="WP-001",
            timestamp="2026-01-01T00:00:00+00:00",
        )
        path = write_dialogue(content, slug_dir=tmp_path, wp_id="WP-001", stage="developer")
        recovered = path.read_text(encoding="utf-8")
        assert recovered == content
        assert "## Human" in recovered
        assert "## Assistant" in recovered
        assert "Token Usage" in recovered
