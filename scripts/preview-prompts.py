#!/usr/bin/env python3
"""
scripts/preview-prompts.py

Render all orchestrator stage prompt templates to
orchestrator/dist/stage-prompts/ using representative placeholder values.

This script is intentionally standalone — it imports only from
orchestrator/src/nodes/prompt_renderer (stdlib-only module) and the
Python standard library.  No .env, no LLM credentials required.

Usage:
    python scripts/preview-prompts.py
    python scripts/preview-prompts.py --stage developer
    python scripts/preview-prompts.py --stage pm
    python scripts/preview-prompts.py --list

Also available via the unified CLI::

    node scripts/cli.js preview-prompts
    node scripts/cli.js preview-prompts --stage developer
    node scripts/cli.js preview-prompts --list

Output
------
Files are written to ``orchestrator/dist/stage-prompts/`` (gitignored).

Each stage produces a single output file: ``{stage}.md``.

``--list`` prints the 8 available stage names and exits without writing
any files.  ``--stage <name>`` renders only the named stage.

Stage registry format
---------------------
``STAGES`` is a list of dicts, one per orchestrator stage, with two fields:

``name`` (str)
    Matches the template filename without the ``.md`` extension
    (e.g. ``"developer"`` loads ``src/nodes/templates/developer.md``).

``extra_vars`` (dict[str, str])
    Stage-specific template variables merged on top of the shared
    ``_BASE_VARS`` dict (``project_path``).  For example, the ``pm``
    stage requires ``plan_file`` and ``extra`` variables that are absent
    from all other templates.

To add a new stage, append a dict to ``STAGES`` matching the template
filename and set ``extra_vars`` accordingly.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from types import MappingProxyType
from typing import TypedDict

# ---------------------------------------------------------------------------
# Path bootstrap — prepend orchestrator/ so the import below resolves without
# an installed package.
# ---------------------------------------------------------------------------

_REPO_ROOT = Path(__file__).parent.parent
_ORCHESTRATOR_DIR = _REPO_ROOT / "orchestrator"
sys.path.insert(0, str(_ORCHESTRATOR_DIR))

from src.nodes.prompt_renderer import load_template, render_prompt  # noqa: E402

# ---------------------------------------------------------------------------
# Stage registry
# ---------------------------------------------------------------------------

class StageEntry(TypedDict):
    name: str
    extra_vars: dict[str, str]


# Each entry describes one orchestrator stage.
# Fields:
#   name        — matches the template filename (without .md)
#   extra_vars  — additional variables merged into the render call
STAGES: list[StageEntry] = [
    {"name": "pm",               "extra_vars": {"plan_file": "plan.md", "extra": "*(plan content would appear here)*"}},
    {"name": "developer",        "extra_vars": {}},
    {"name": "qa",               "extra_vars": {}},
    {"name": "security_auditor", "extra_vars": {}},
    {"name": "reviewer",         "extra_vars": {}},
    {"name": "release_engineer", "extra_vars": {}},
    {"name": "docs",             "extra_vars": {}},
    {"name": "synthesis",        "extra_vars": {}},
]

# Ordered list of the 8 stage names (used by --list and --stage validation)
STAGE_NAMES: list[str] = [s["name"] for s in STAGES]

# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

_BASE_VARS: MappingProxyType[str, str] = MappingProxyType({
    "project_path": "/path/to/your/project",
})


def _render_stage(stage: StageEntry) -> str:
    """Render *stage* with the base variables and any stage-specific extras."""
    variables: dict[str, str] = {
        **_BASE_VARS,
        **stage["extra_vars"],
    }
    template = load_template(stage["name"])
    return render_prompt(template, variables)


def render_and_write(stage: StageEntry, out_dir: Path) -> list[Path]:
    """Render *stage* and write a single output file to *out_dir*.

    Returns the list of Path objects that were written.
    """
    content = _render_stage(stage)
    dest = out_dir / f"{stage['name']}.md"
    dest.write_text(content, encoding="utf-8")
    return [dest]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="preview-prompts",
        description=(
            "Render orchestrator stage prompt templates to "
            "orchestrator/dist/stage-prompts/"
        ),
    )
    parser.add_argument(
        "--stage",
        metavar="<name>",
        help=(
            "Render a single stage only. "
            f"Valid names: {', '.join(STAGE_NAMES)}"
        ),
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print the available stage names (one per line) and exit.",
    )
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # --list: print names and exit immediately (no file I/O)
    if args.list:
        for name in STAGE_NAMES:
            print(name)
        sys.exit(0)

    # --stage validation
    if args.stage is not None and args.stage not in STAGE_NAMES:
        parser.error(
            f"invalid stage {args.stage!r}. "
            f"Valid names: {', '.join(STAGE_NAMES)}"
        )

    # Determine which stages to render
    if args.stage is not None:
        stages_to_render = [s for s in STAGES if s["name"] == args.stage]
    else:
        stages_to_render = STAGES

    # Ensure output directory exists
    out_dir = _ORCHESTRATOR_DIR / "dist" / "stage-prompts"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Render and report
    all_written: list[Path] = []
    for stage in stages_to_render:
        written = render_and_write(stage, out_dir)
        all_written.extend(written)

    for dest in all_written:
        # Print relative to repo root for readability
        rel = dest.relative_to(_REPO_ROOT)
        print(f"  \u2713 {rel}")

    print(f"\n{len(all_written)} file(s) written to orchestrator/dist/stage-prompts/")


if __name__ == "__main__":
    main()
