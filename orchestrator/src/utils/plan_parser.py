"""
utils/plan_parser.py — Plan document parser.

Provides :func:`parse_plan` which extracts the plan title, summary, and full
content from a Markdown plan document, and :class:`PlanMetadata` which holds
the result.

Parsing rules
-------------
- YAML frontmatter (delimited by ``---``) is stripped before heading
  extraction.
- The **title** is the first top-level heading (``# Title``).
- The **summary** is the first non-empty paragraph that follows the title
  (headings, horizontal rules, and image-only lines are skipped).

Example::

    meta = parse_plan("docs/agents/plans/2026-02-24-langgraph-orchestrator/plan.md")
    print(meta.title)    # "LangGraph Orchestrator"
    print(meta.summary)  # first body paragraph
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class PlanMetadata:
    """
    Structured metadata extracted from a plan Markdown document.

    Attributes
    ----------
    title:
        The plan's primary heading (first ``# …`` line), or an empty string
        if no H1 heading is found.
    summary:
        The first body paragraph after the title.  Provides the LLM with a
        concise overview of the plan.  Empty string if not found.
    file_path:
        Absolute path to the source file on disk.
    raw_content:
        Full Markdown content of the file (including any frontmatter).
    """

    title: str
    summary: str
    file_path: str
    raw_content: str = field(repr=False)


# ---------------------------------------------------------------------------
# Compiled regex patterns
# ---------------------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"^---\s*\n.*?\n---\s*\n", re.DOTALL)
_H1_RE = re.compile(r"^#\s+(.+)$", re.MULTILINE)
_BLANK_LINE_RE = re.compile(r"\n{2,}")


def parse_plan(plan_file: str) -> PlanMetadata:
    """
    Parse a Markdown plan document and return structured :class:`PlanMetadata`.

    Parameters
    ----------
    plan_file:
        Path to the plan Markdown file.  Both absolute and relative paths are
        accepted; relative paths are resolved from the current working
        directory.

    Returns
    -------
    PlanMetadata
        Extracted title, summary, absolute file path, and raw content.

    Raises
    ------
    FileNotFoundError
        If *plan_file* does not exist on disk.
    """
    path = Path(plan_file).resolve()
    if not path.exists():
        raise FileNotFoundError(f"Plan file not found: {plan_file}")

    raw_content = path.read_text(encoding="utf-8")

    # Strip YAML frontmatter if present.
    body = _FRONTMATTER_RE.sub("", raw_content).strip()

    # Extract title from the first H1 heading.
    title_match = _H1_RE.search(body)
    title = title_match.group(1).strip() if title_match else ""

    # Extract summary: first substantive paragraph after the title.
    summary = _extract_summary(body, title_match)

    return PlanMetadata(
        title=title,
        summary=summary,
        file_path=str(path),
        raw_content=raw_content,
    )


def _extract_summary(body: str, title_match: re.Match[str] | None) -> str:
    """
    Return the first non-empty paragraph that follows the title heading.

    Headings (``#``), horizontal rules (``---``/``===``), and image-only lines
    are skipped so that the returned text is always a narrative paragraph.
    """
    start = title_match.end() if title_match else 0
    remainder = body[start:].strip()

    for block in _BLANK_LINE_RE.split(remainder):
        block = block.strip()
        if not block:
            continue
        # Skip headings.
        if block.startswith("#"):
            continue
        # Skip horizontal rules.
        if re.match(r"^(-{3,}|={3,})\s*$", block):
            continue
        # Skip badge / image-only lines.
        if block.startswith("!["):
            continue
        # Collapse internal newlines to a single space for a clean summary.
        return " ".join(line.strip() for line in block.splitlines() if line.strip())

    return ""
