"""
test_prompt_renderer.py — Regression guard for src/nodes/prompt_renderer.py.

Covers the four public functions:
- load_template(stage)
- load_partial(name)
- render_prompt(template, variables)
- clear_template_cache()

Behaviours verified by the WP-001 QA scripts are captured here as permanent
pytest assertions so no future refactor can silently break the renderer.
"""

from __future__ import annotations

import ast
import importlib
import inspect
from pathlib import Path

import pytest

from src.nodes.prompt_renderer import (
    clear_template_cache,
    load_partial,
    load_template,
    render_prompt,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "src" / "nodes" / "templates"


# ---------------------------------------------------------------------------
# Module-level checks
# ---------------------------------------------------------------------------


class TestModuleStructure:
    """Verify structural invariants of the renderer module itself."""

    def test_three_public_functions_are_importable(self):
        """load_template, render_prompt, clear_template_cache must all be importable."""
        from src.nodes import prompt_renderer  # noqa: F401 (import check)

        assert callable(load_template)
        assert callable(render_prompt)
        assert callable(clear_template_cache)
        assert callable(load_partial)

    def test_stdlib_only_imports(self):
        """prompt_renderer must not import any non-stdlib dependency."""
        import src.nodes.prompt_renderer as pm

        source = inspect.getsource(pm)
        tree = ast.parse(source)
        discovered: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                discovered.extend(n.name.split(".")[0] for n in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    discovered.append(node.module.split(".")[0])
        allowed = {"re", "pathlib", "collections", "__future__", "typing", "annotations"}
        non_stdlib = [m for m in discovered if m not in allowed and not m.startswith("_")]
        assert non_stdlib == [], f"Non-stdlib imports found: {non_stdlib}"

    def test_templates_directory_exists(self):
        """orchestrator/src/nodes/templates/ must exist."""
        assert _TEMPLATES_DIR.is_dir(), f"templates/ not found at {_TEMPLATES_DIR}"


# ---------------------------------------------------------------------------
# load_template
# ---------------------------------------------------------------------------


class TestLoadTemplate:
    """Behaviour of load_template()."""

    def setup_method(self):
        clear_template_cache()

    def test_raises_file_not_found_for_missing_stage(self, tmp_path):
        """load_template('nonexistent') must raise FileNotFoundError, not return None."""
        with pytest.raises(FileNotFoundError):
            load_template("nonexistent_stage_xyz_test_sentinel")

    def test_caches_result_on_second_call(self, tmp_path, monkeypatch):
        """Second call for the same stage must return the cached string without re-reading."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        stage_file = tmp_path / "cached_stage.md"
        stage_file.write_text("original content", encoding="utf-8")

        first = load_template("cached_stage")
        assert first == "original content"

        # Modify the file after the first load — cache must still return original.
        stage_file.write_text("modified content", encoding="utf-8")
        second = load_template("cached_stage")
        assert second == "original content", "Cache was not used on second call"

    def test_clear_cache_forces_reread(self, tmp_path, monkeypatch):
        """clear_template_cache() must cause load_template to re-read from disk."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        stage_file = tmp_path / "reload_stage.md"
        stage_file.write_text("v1", encoding="utf-8")
        assert load_template("reload_stage") == "v1"

        stage_file.write_text("v2", encoding="utf-8")
        clear_template_cache()
        assert load_template("reload_stage") == "v2"

    def test_returns_str_not_bytes(self, tmp_path, monkeypatch):
        """load_template must return a str, not bytes."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        (tmp_path / "str_stage.md").write_text("hello", encoding="utf-8")
        result = load_template("str_stage")
        assert isinstance(result, str)

    @pytest.mark.parametrize(
        "name",
        [
            "../etc/passwd",
            "",
            "name.with.dots",
            "/absolute/path",
            "has space",
            "semi;colon",
        ],
    )
    def test_raises_value_error_for_invalid_name(self, name):
        """load_template raises ValueError for names that don't match [\\w-]+."""
        with pytest.raises(ValueError):
            load_template(name)


# ---------------------------------------------------------------------------
# load_partial
# ---------------------------------------------------------------------------


class TestLoadPartial:
    """Behaviour of load_partial()."""

    def setup_method(self):
        clear_template_cache()

    def test_reads_partial_file(self, tmp_path, monkeypatch):
        """load_partial('example') reads templates/partials/example.md."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "example.md").write_text("partial content", encoding="utf-8")
        result = load_partial("example")
        assert result == "partial content"

    def test_returns_str_not_bytes(self, tmp_path, monkeypatch):
        """load_partial must return a str, not bytes."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "str_partial.md").write_text("hello", encoding="utf-8")
        result = load_partial("str_partial")
        assert isinstance(result, str)

    def test_caches_result_on_second_call(self, tmp_path, monkeypatch):
        """Second call for the same partial must return cached string without re-reading."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        partial_file = tmp_path / "cached.md"
        partial_file.write_text("original", encoding="utf-8")

        first = load_partial("cached")
        assert first == "original"

        partial_file.write_text("modified", encoding="utf-8")
        second = load_partial("cached")
        assert second == "original", "Cache was not used on second call"

    def test_raises_file_not_found_for_missing_partial(self):
        """load_partial('nonexistent') must raise FileNotFoundError."""
        with pytest.raises(FileNotFoundError):
            load_partial("nonexistent_partial_xyz_sentinel")

    def test_clear_cache_forces_reread(self, tmp_path, monkeypatch):
        """clear_template_cache() must cause load_partial to re-read from disk."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        partial_file = tmp_path / "reread.md"
        partial_file.write_text("v1", encoding="utf-8")
        assert load_partial("reread") == "v1"

        partial_file.write_text("v2", encoding="utf-8")
        clear_template_cache()
        assert load_partial("reread") == "v2"

    @pytest.mark.parametrize(
        "name",
        [
            "../etc/passwd",
            "",
            "name.with.dots",
            "/absolute/path",
            "has space",
            "semi;colon",
        ],
    )
    def test_raises_value_error_for_invalid_name(self, name):
        """load_partial raises ValueError for names that don't match [\\w-]+."""
        with pytest.raises(ValueError):
            load_partial(name)


# ---------------------------------------------------------------------------
# render_prompt — include directives
# ---------------------------------------------------------------------------


class TestRenderPromptIncludes:
    """{{> partial-name}} include directive behaviour."""

    def setup_method(self):
        clear_template_cache()

    def test_include_replaced_with_partial_content(self, tmp_path, monkeypatch):
        """render_prompt() replaces {{> name}} markers with partial file content."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "greeting.md").write_text("Hello from partial\n", encoding="utf-8")
        template = "Before\n{{> greeting}}\nAfter"
        result = render_prompt(template, {})
        assert "Hello from partial" in result
        assert "Before" in result
        assert "After" in result
        assert "{{>" not in result

    def test_variables_in_partial_are_substituted(self, tmp_path, monkeypatch):
        """Variables inside included partials (e.g., {wp_id}) are substituted correctly."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "scope.md").write_text("Scope: {wp_id}\n", encoding="utf-8")
        template = "{{> scope}}\nEnd"
        result = render_prompt(template, {"wp_id": "WP-042"})
        assert "Scope: WP-042" in result

    def test_include_resolved_before_conditionals(self, tmp_path, monkeypatch):
        """{{> partial}} includes are resolved before {{#if}} evaluation."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        # Partial contains an {{#if}} block that must be evaluated after inclusion.
        (tmp_path / "cond.md").write_text(
            "{{#if show}}\nConditional text\n{{/if}}\n", encoding="utf-8"
        )
        template = "{{> cond}}\nEnd"

        result_show = render_prompt(template, {"show": "yes"})
        assert "Conditional text" in result_show

        result_hide = render_prompt(template, {"show": ""})
        assert "Conditional text" not in result_hide

    def test_no_recursive_includes(self, tmp_path, monkeypatch):
        """{{> partial}} inside a partial (one level deep) is resolved correctly."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "outer.md").write_text("{{> inner}}\n", encoding="utf-8")
        (tmp_path / "inner.md").write_text("Inner content\n", encoding="utf-8")
        template = "{{> outer}}\nEnd"
        result = render_prompt(template, {})
        # One level deep: inner content IS resolved via outer → inner expansion.
        assert "Inner content" in result
        assert "End" in result

    def test_includes_not_resolved_beyond_one_level(self, tmp_path, monkeypatch):
        """{{> partial}} inside a second-level partial (two levels deep) is NOT resolved."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "outer.md").write_text("{{> inner}}\n", encoding="utf-8")
        (tmp_path / "inner.md").write_text("{{> deepest}}\n", encoding="utf-8")
        (tmp_path / "deepest.md").write_text("Deepest content\n", encoding="utf-8")
        template = "{{> outer}}\nEnd"
        result = render_prompt(template, {})
        # Two levels deep: deepest content must NOT appear.
        assert "Deepest content" not in result
        assert "End" in result

    def test_inline_include_ignored(self, tmp_path, monkeypatch):
        """{{> name}} preceded by other text on the same line is not processed."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "side.md").write_text("injected content\n", encoding="utf-8")
        # The include marker has text before it — must NOT be expanded.
        template = "text before {{> side}}"
        result = render_prompt(template, {})
        assert "injected content" not in result


# ---------------------------------------------------------------------------
# render_prompt — conditional blocks
# ---------------------------------------------------------------------------


class TestRenderPromptConditionals:
    """{{#if var}}…{{/if}} block evaluation."""

    _TEMPLATE = "Header\n{{#if show}}\nVisible content\n{{/if}}\nFooter"

    def test_truthy_variable_includes_block(self):
        out = render_prompt(self._TEMPLATE, {"show": "yes"})
        assert "Visible content" in out
        assert "Footer" in out

    def test_falsy_empty_string_hides_block(self):
        out = render_prompt(self._TEMPLATE, {"show": ""})
        assert "Visible content" not in out
        assert "Footer" in out

    def test_missing_key_hides_block(self):
        """Missing keys are falsy (defaultdict(str) → empty string)."""
        out = render_prompt(self._TEMPLATE, {})
        assert "Visible content" not in out

    def test_block_markers_stripped_from_truthy_output(self):
        out = render_prompt(self._TEMPLATE, {"show": "yes"})
        assert "{{#if" not in out
        assert "{{/if}}" not in out

    def test_block_markers_stripped_from_falsy_output(self):
        out = render_prompt(self._TEMPLATE, {"show": ""})
        assert "{{#if" not in out
        assert "{{/if}}" not in out

    def test_multiple_independent_blocks(self):
        template = "{{#if a}}\nA block\n{{/if}}\n{{#if b}}\nB block\n{{/if}}\nEnd"
        out = render_prompt(template, {"a": "1", "b": ""})
        assert "A block" in out
        assert "B block" not in out
        assert "End" in out

    def test_inline_if_marker_not_processed_as_conditional(self):
        """Markers not on their own line are not processed as conditional blocks.
        
        Note: Python's format_map transforms ``{{`` → ``{`` as escape notation,
        so inline markers like ``{{#if var}}`` become ``{#if var}`` in the output.
        This is not a conditional block evaluation — it is a format_map side-effect.
        The key invariant is: the block body is NOT conditionally included/excluded.
        """
        template = "Inline {{#if var}} not-a-block {{/if}} text"
        out = render_prompt(template, {"var": "yes"})
        # Block body is not conditionally evaluated (it always appears).
        assert "not-a-block" in out
        # format_map consumes the double-braces as escape sequences.
        assert "{{#if var}}" not in out


# ---------------------------------------------------------------------------
# render_prompt — variable substitution
# ---------------------------------------------------------------------------


class TestRenderPromptVariables:
    """{{variable}} substitution behaviour."""

    def test_present_variable_substituted(self):
        out = render_prompt("Value is {x}", {"x": "42"})
        assert out == "Value is 42"

    def test_missing_variable_resolves_to_empty_string(self):
        out = render_prompt("A={missing} B={present}", {"present": "X"})
        assert "{" not in out
        assert "X" in out
        assert "A= B=X" == out

    def test_multiple_variables_substituted(self):
        out = render_prompt("{a} and {b}", {"a": "hello", "b": "world"})
        assert out == "hello and world"

    def test_empty_variables_dict_leaves_no_placeholders(self):
        out = render_prompt("no vars here", {})
        assert out == "no vars here"


# ---------------------------------------------------------------------------
# render_prompt — blank line collapse
# ---------------------------------------------------------------------------


class TestRenderPromptBlankLineCollapse:
    """Consecutive blank lines (3+) are collapsed to a single blank line."""

    def test_three_newlines_collapsed(self):
        out = render_prompt("line1\n\n\n\nline2", {})
        assert "\n\n\n" not in out

    def test_two_newlines_preserved(self):
        """Two newlines (one blank line) must NOT be collapsed."""
        out = render_prompt("line1\n\nline2", {})
        assert "\n\n" in out

    def test_collapse_after_conditional_removal(self):
        """Removing a conditional block must not leave triple-blank-line gaps."""
        template = "Start\n\n{{#if gone}}\nRemoved\n{{/if}}\n\nEnd"
        out = render_prompt(template, {"gone": ""})
        assert "\n\n\n" not in out
        assert "End" in out


# ---------------------------------------------------------------------------
# render_prompt — combined pipeline
# ---------------------------------------------------------------------------


class TestRenderPromptPipeline:
    """End-to-end render_prompt behaviour with realistic template fragments."""

    def test_standard_prompt_fragment(self):
        """Minimal stage-prompt template renders correctly."""
        template = (
            "{{#if preamble}}\n"
            "{preamble}\n"
            "{{/if}}\n"
            "**Project:** `{project_path}`\n"
            "{{#if wp_id}}\n"
            "**Work package:** {wp_id}\n"
            "{{/if}}\n"
            "{project_path_reminder}"
        )
        out = render_prompt(
            template,
            {
                "preamble": "Do great work.",
                "project_path": "/some/path",
                "wp_id": "WP-001",
                "project_path_reminder": "Always use the project path.",
            },
        )
        assert "Do great work." in out
        assert "/some/path" in out
        assert "WP-001" in out
        assert "Always use the project path." in out
        assert "{{" not in out

    def test_wp_id_omitted_when_empty(self):
        template = "{{#if wp_id}}\n**Work package:** {wp_id}\n{{/if}}\n{project_path}"
        out = render_prompt(template, {"wp_id": "", "project_path": "/p"})
        assert "Work package" not in out
        assert "/p" in out

    def test_partial_include_in_pipeline(self, tmp_path, monkeypatch):
        """Template fragment using {{> partial}} syntax renders correctly end-to-end."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "wp-scope-reminder.md").write_text(
            "Only work on: {wp_id}\n", encoding="utf-8"
        )
        template = (
            "**Project:** `{project_path}`\n"
            "{{> wp-scope-reminder}}\n"
            "{{#if preamble}}\n"
            "{preamble}\n"
            "{{/if}}\n"
        )
        out = render_prompt(
            template,
            {
                "project_path": "/some/path",
                "wp_id": "WP-007",
                "preamble": "Do great work.",
            },
        )
        assert "/some/path" in out
        assert "Only work on: WP-007" in out
        assert "Do great work." in out
        assert "{{>" not in out


# ---------------------------------------------------------------------------
# clear_template_cache
# ---------------------------------------------------------------------------


class TestClearTemplateCache:
    """clear_template_cache() contract."""

    def test_callable_without_error(self):
        clear_template_cache()  # must not raise

    def test_callable_when_cache_already_empty(self):
        clear_template_cache()
        clear_template_cache()  # idempotent

    def test_clears_cached_entries(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._TEMPLATES_DIR",
            tmp_path,
        )
        (tmp_path / "clr.md").write_text("cached", encoding="utf-8")
        load_template("clr")
        clear_template_cache()
        (tmp_path / "clr.md").write_text("fresh", encoding="utf-8")
        assert load_template("clr") == "fresh"

    def test_clears_partial_cache_entries(self, tmp_path, monkeypatch):
        """clear_template_cache() must also clear the partial cache."""
        monkeypatch.setattr(
            "src.nodes.prompt_renderer._PARTIALS_DIR",
            tmp_path,
        )
        (tmp_path / "clr_partial.md").write_text("v1", encoding="utf-8")
        load_partial("clr_partial")
        clear_template_cache()
        (tmp_path / "clr_partial.md").write_text("v2", encoding="utf-8")
        assert load_partial("clr_partial") == "v2"


# ---------------------------------------------------------------------------
# Integration: importable from src.nodes
# ---------------------------------------------------------------------------


class TestNodeModuleImports:
    """All 8 stage node modules must import cleanly with the current __init__.py state."""

    @pytest.mark.parametrize(
        "module_name",
        [
            "src.nodes.developer",
            "src.nodes.qa",
            "src.nodes.reviewer",
            "src.nodes.docs",
            "src.nodes.security_auditor",
            "src.nodes.release_engineer",
            "src.nodes.pm",
            "src.nodes.synthesis",
        ],
    )
    def test_stage_module_importable(self, module_name):
        """No NameError or ImportError when importing stage node modules."""
        mod = importlib.import_module(module_name)
        assert mod is not None

    def test_build_stage_prompt_not_in_nodes(self):
        """build_stage_prompt must not exist in src.nodes (it was removed by WP-004)."""
        import src.nodes as nodes_mod

        assert not hasattr(nodes_mod, "build_stage_prompt"), (
            "build_stage_prompt was re-introduced — it was intentionally removed by WP-004"
        )
