"""Shared revision-numbering helper for chunk and dialogue files."""

from __future__ import annotations

import re
from pathlib import Path


def next_revision(directory: Path, wp_id: str, stage: str, ext: str) -> int:
    """Return the next revision number for *wp_id*/*stage* files in *directory*.

    Globs ``{wp_id}-{stage}-r*{ext}`` inside *directory*, parses the integer
    revision from each matching filename, and returns ``max + 1``.  Returns
    ``0`` when no prior files exist.

    *ext* includes the leading dot (e.g. ``".jsonl"``, ``".md"``).
    """
    pattern = f"{wp_id}-{stage}-r*{ext}"
    # Regex to extract the revision number from the stem.
    rev_re = re.compile(rf"^{re.escape(wp_id)}-{re.escape(stage)}-r(\d+)$")

    max_rev: int | None = None
    for path in directory.glob(pattern):
        m = rev_re.match(path.stem)
        if m is None:
            continue
        rev = int(m.group(1))
        if max_rev is None or rev > max_rev:
            max_rev = rev

    return 0 if max_rev is None else max_rev + 1
