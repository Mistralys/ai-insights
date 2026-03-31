"""
nodes/prompt_renderer.py — Lightweight template renderer for stage prompts.

Provides:
- ``load_template(stage)`` — loads and caches a ``.md`` template from the
  ``templates/`` directory relative to this module.
- ``load_partial(name)`` — loads and caches a ``.md`` partial from the
  ``templates/partials/`` directory relative to this module.
- ``render_prompt(template, variables)`` — processes ``{{> partial}}`` includes,
  ``{{#if}}…{{/if}}`` conditional blocks, and substitutes ``{variable}``
  placeholders.
- ``clear_template_cache()`` — resets both in-memory caches for test support.

Template syntax
---------------
``{variable}``
    Substituted from the variables dict.  Missing keys resolve to empty string
    via ``defaultdict(str)``.

``{{`` / ``}}``
    Literal brace escape sequences used by ``str.format_map``.  ``{{``
    renders as ``{`` and ``}}`` renders as ``}`` in the output.  This means
    that inline ``{{#if}}`` or ``{{> …}}`` markers that are *not* on their
    own line are passed through this step unchanged and will appear as
    ``{#if}`` / ``{> …}`` in the final output rather than being evaluated
    as conditional or include directives.

``{{#if variable}}`` … ``{{/if}}``
    Conditional block.  The block (including its marker lines) is included only
    when ``variables[variable]`` is truthy; otherwise the entire block is
    removed.  Nesting is not supported.  Both marker lines must appear on their
    own line.

``{{> partial-name}}``
    Include directive.  Must appear on its own line (no preceding text).
    Replaced with the content of ``templates/partials/{partial-name}.md``
    before conditional evaluation.  Variables inside partials are substituted
    in the variable-substitution step.  Recursive includes within partial
    files are not resolved.

Post-processing
---------------
After substitution, consecutive blank lines (3+ ``\\n`` chars) are collapsed
to a single blank line (``\\n\\n``).

Uses only Python stdlib: ``re``, ``pathlib``, ``collections.defaultdict``.
"""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------

_TEMPLATES_DIR: Path = Path(__file__).parent / "templates"
_PARTIALS_DIR: Path = _TEMPLATES_DIR / "partials"

_cache: dict[str, str] = {}
_partial_cache: dict[str, str] = {}

# Matches a full {{#if var}} … {{/if}} block where both markers appear at the
# start of a line.  The trailing \n? after {{/if}} is consumed so the blank
# line following a removed block is not left behind.
# (\w+) — no hyphens: conditional variable names are Python identifiers
# (letters, digits, underscores only; hyphens are not valid identifier chars).
_IF_BLOCK_RE: re.Pattern[str] = re.compile(
    r"^\{\{#if\s+(\w+)\}\}\n(.*?)^\{\{/if\}\}\n?",
    re.DOTALL | re.MULTILINE,
)

# Matches a {{> partial-name}} include directive on its own line.  The marker
# must appear at the start of a line; inline occurrences (preceded by other
# text) do not match.  The trailing \n? consumes the line break so the partial
# content is inserted cleanly in its place.
# ([\w-]+) — hyphens allowed: partial file names follow kebab-case convention
# (e.g. "wp-scope-reminder"), unlike template variable names captured above.
_INCLUDE_RE: re.Pattern[str] = re.compile(
    r"^\{\{>\s*([\w-]+)\s*\}\}\n?",
    re.MULTILINE,
)

# Three or more consecutive newlines → collapse to two (one blank line).
_MULTI_BLANK_RE: re.Pattern[str] = re.compile(r"\n{3,}")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_template(stage: str) -> str:
    """Load and cache the Markdown template for *stage*.

    Reads ``orchestrator/src/nodes/templates/{stage}.md`` relative to this
    module.  The result is cached in-process; subsequent calls for the same
    stage return the cached string without re-reading the file.

    Parameters
    ----------
    stage:
        Stage name matching the template filename, e.g. ``"developer"``.
        Must consist of word characters and hyphens only (``[\\w-]+``); no
        path separators or dots are permitted.

    Returns
    -------
    str
        Raw template content (UTF-8).

    Raises
    ------
    ValueError
        If *stage* does not match ``[\\w-]+`` (i.e. contains path separators,
        dots, spaces, or is empty).
    FileNotFoundError
        If no template file exists for *stage*.
    """
    if not re.fullmatch(r"[\w-]+", stage):
        raise ValueError(
            f"Invalid template name {stage!r}: must match [\\w-]+ "
            "(word characters and hyphens only; no path separators, dots, or spaces)"
        )
    if stage not in _cache:
        path = _TEMPLATES_DIR / f"{stage}.md"
        _cache[stage] = path.read_text(encoding="utf-8")
    return _cache[stage]


def load_partial(name: str) -> str:
    """Load and cache the Markdown partial *name*.

    Reads ``orchestrator/src/nodes/templates/partials/{name}.md`` relative to
    this module.  The result is cached in-process; subsequent calls for the
    same name return the cached string without re-reading the file.

    Parameters
    ----------
    name:
        Partial name matching the file stem, e.g. ``"wp-scope-reminder"``.
        Must consist of word characters and hyphens only (``[\\w-]+``); no
        path separators or dots are permitted.

    Returns
    -------
    str
        Raw partial content (UTF-8).

    Raises
    ------
    ValueError
        If *name* does not match ``[\\w-]+`` (i.e. contains path separators,
        dots, spaces, or is empty).
    FileNotFoundError
        If no partial file exists for *name*.
    """
    if not re.fullmatch(r"[\w-]+", name):
        raise ValueError(
            f"Invalid partial name {name!r}: must match [\\w-]+ "
            "(word characters and hyphens only; no path separators, dots, or spaces)"
        )
    if name not in _partial_cache:
        path = _PARTIALS_DIR / f"{name}.md"
        _partial_cache[name] = path.read_text(encoding="utf-8")
    return _partial_cache[name]


def clear_template_cache() -> None:
    """Clear the in-memory template and partial caches.

    Intended for test support.  Allows tests to inject fresh template or
    partial content, or verify that :func:`load_template` and
    :func:`load_partial` re-read from disk.
    """
    _cache.clear()
    _partial_cache.clear()


def render_prompt(template: str, variables: dict[str, str]) -> str:
    """Render *template* with *variables* and return the resulting string.

    Processing is applied in four sequential steps:

    0. **Include resolution** — Each ``{{> partial-name}}`` marker on its own
       line is replaced with the content of the corresponding partial file
       (loaded via :func:`load_partial`).  A single additional pass then
       expands any ``{{> partial}}`` directives found within the loaded
       partial content (one level deep).  Directives inside the second-level
       partials are not resolved.  Variables inside included content are
       substituted in step 2.

    1. **Conditional blocks** — Each ``{{#if var}} … {{/if}}`` block is
       evaluated: if ``variables[var]`` is truthy the block body is kept and
       both marker lines are removed; if falsy the entire block (markers and
       body) is removed.

    2. **Variable substitution** — ``{variable}`` placeholders are replaced
       using ``str.format_map`` backed by a ``defaultdict(str)`` so that
       missing keys silently become empty strings.  ``{{`` and ``}}`` are
       the ``format_map`` escape sequences for literal braces: ``{{`` →
       ``{``, ``}}`` → ``}``.  As a side-effect, any inline ``{{#if}}`` or
       ``{{> …}}`` markers that survived step 0 and step 1 (because they
       were not on their own line) will be reduced to ``{#if}`` / ``{> …}``
       in the output — not evaluated as directives.

    3. **Blank-line collapse** — Three or more consecutive newlines are
       reduced to two (preserving at most one blank line between sections).

    Parameters
    ----------
    template:
        Raw template string, typically returned by :func:`load_template`.
    variables:
        Mapping of variable names to their string values.

    Returns
    -------
    str
        The fully rendered prompt string.
    """
    # Build a defaultdict so missing {placeholders} → "" during format_map.
    _vars: defaultdict[str, str] = defaultdict(str, variables)

    def _process_block(match: re.Match[str]) -> str:
        """Return block body when variable is truthy, else empty string."""
        var_name = match.group(1)
        body: str = match.group(2)
        return body if _vars[var_name] else ""

    # Step 0 — resolve {{> partial}} includes (one-level-deep expansion in partials)
    def _expand_partial(name: str) -> str:
        """Load partial and expand any first-level {{> include}} within it."""
        content = load_partial(name)
        return _INCLUDE_RE.sub(lambda m: load_partial(m.group(1)), content)

    result = _INCLUDE_RE.sub(lambda m: _expand_partial(m.group(1)), template)

    # Step 1 — evaluate {{#if}} … {{/if}} blocks
    result = _IF_BLOCK_RE.sub(_process_block, result)

    # Step 2 — substitute {variable} placeholders
    result = result.format_map(_vars)

    # Step 3 — collapse runs of 3+ newlines to a single blank line
    result = _MULTI_BLANK_RE.sub("\n\n", result)

    return result
