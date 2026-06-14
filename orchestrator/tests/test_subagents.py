"""Unit tests for orchestrator/src/utils/subagents.py.

Covers:
  - Stage with declared subagents → returns populated list with kebab-case names,
    descriptions from standalone YAML, and system_prompts from deep-agents files.
  - Stage with no subagents key → returns [].
  - Unknown stage (not in manifest) → returns [].
  - Cache hit → second call re-uses cached content.
  - Cache clear → subsequent call re-reads files.
  - Missing standalone YAML → FileNotFoundError.
  - Missing deep-agents file → FileNotFoundError (after standalone YAML exists).
  - Missing description field in standalone YAML → ValueError.
  - Integration: pm stage on the real workspace returns 4 specs.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.subagents import clear_cache, load_subagents

# Workspace root: two levels above orchestrator/tests/.
_WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean_cache():
    """Ensure a clean subagent cache before and after each test."""
    clear_cache()
    yield
    clear_cache()


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

_MINIMAL_MANIFEST = {
    "roles": [
        {"id": "pm",        "number": 2, "name": "Project Manager"},
        {"id": "developer", "number": 3, "name": "Developer"},
    ]
}


def _make_workspace(
    tmp_path: Path,
    *,
    pm_subagents: list[str] | None = None,
    standalone_yaml: dict[str, str] | None = None,       # slug → description (None = omit field)
    deep_agents: dict[str, str] | None = None,             # slug → file content
    ledger_support_yaml: dict[str, str] | None = None,    # slug → description (ledger-support suite)
    ledger_support_deep_agents: dict[str, str] | None = None,  # slug → file content
    manifest: dict | None = None,
) -> Path:
    """Create a minimal workspace fixture under *tmp_path*.

    *pm_subagents* — list of slug strings to put in the ``subagents:`` block
    of the PM ledger YAML (2-project-manager.yaml).  When ``None`` the key is
    omitted entirely, simulating a stage with no subagents declared.

    *standalone_yaml* — mapping of slug → description string.  Each entry
    creates ``personas/standalone/src/meta/{slug}.yaml``.  Pass the slug key
    with an empty string to create a YAML file intentionally missing the
    description field.

    *deep_agents* — mapping of slug → file content.  Each entry creates
    ``personas/standalone/deep-agents/{slug}.md``.

    *ledger_support_yaml* — mapping of slug → description string for the
    ledger-support suite (``personas/ledger-support/src/meta/{slug}.yaml``).

    *ledger_support_deep_agents* — mapping of slug → file content for the
    ledger-support suite (``personas/ledger-support/deep-agents/{slug}.md``).

    *manifest* — override the default minimal manifest.
    """
    m = manifest or _MINIMAL_MANIFEST

    # shared/workflow-manifest.json
    shared_dir = tmp_path / "shared"
    shared_dir.mkdir(parents=True)
    (shared_dir / "workflow-manifest.json").write_text(
        json.dumps(m), encoding="utf-8"
    )

    # personas/ledger/src/meta/
    ledger_meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
    ledger_meta_dir.mkdir(parents=True)

    # PM ledger YAML (number: 2)
    pm_lines = ["number: 2\nrole: Project Manager\n"]
    if pm_subagents is not None:
        pm_lines.append("subagents:\n")
        for slug in pm_subagents:
            pm_lines.append(f"  - {slug}\n")
    (ledger_meta_dir / "2-project-manager.yaml").write_text(
        "".join(pm_lines), encoding="utf-8"
    )

    # Developer ledger YAML (number: 3, no subagents)
    (ledger_meta_dir / "3-developer.yaml").write_text(
        "number: 3\nrole: Developer\n", encoding="utf-8"
    )

    # personas/standalone/src/meta/
    standalone_meta_dir = tmp_path / "personas" / "standalone" / "src" / "meta"
    standalone_meta_dir.mkdir(parents=True)

    for slug, description in (standalone_yaml or {}).items():
        if description:
            content = f"slug: {slug}\ndescription: \"{description}\"\n"
        else:
            # Deliberately omit description field to test ValueError path.
            content = f"slug: {slug}\nname: \"Some Name\"\n"
        (standalone_meta_dir / f"{slug}.yaml").write_text(content, encoding="utf-8")

    # personas/standalone/deep-agents/
    deep_agents_dir = tmp_path / "personas" / "standalone" / "deep-agents"
    deep_agents_dir.mkdir(parents=True)

    for slug, content in (deep_agents or {}).items():
        (deep_agents_dir / f"{slug}.md").write_text(content, encoding="utf-8")

    # personas/ledger-support/src/meta/
    ledger_support_meta_dir = tmp_path / "personas" / "ledger-support" / "src" / "meta"
    ledger_support_meta_dir.mkdir(parents=True)

    for slug, description in (ledger_support_yaml or {}).items():
        if description:
            content = f"slug: {slug}\ndescription: \"{description}\"\n"
        else:
            content = f"slug: {slug}\nname: \"Some Name\"\n"
        (ledger_support_meta_dir / f"{slug}.yaml").write_text(content, encoding="utf-8")

    # personas/ledger-support/deep-agents/
    ledger_support_da_dir = tmp_path / "personas" / "ledger-support" / "deep-agents"
    ledger_support_da_dir.mkdir(parents=True)

    for slug, content in (ledger_support_deep_agents or {}).items():
        (ledger_support_da_dir / f"{slug}.md").write_text(content, encoding="utf-8")

    return tmp_path


# ---------------------------------------------------------------------------
# Happy-path tests
# ---------------------------------------------------------------------------

class TestLoadSubagentsHappyPath:
    """Stage with declared subagents returns a correctly structured list."""

    def test_returns_expected_number_of_specs(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["slug-alpha", "slug-beta"],
            standalone_yaml={"slug-alpha": "Alpha does things.", "slug-beta": "Beta helps."},
            deep_agents={
                "slug-alpha": "# Alpha\nSystem prompt alpha.",
                "slug-beta": "# Beta\nSystem prompt beta.",
            },
        )
        result = load_subagents("pm", workspace_root=ws)
        assert len(result) == 2

    def test_name_is_kebab_case_slug(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-kebab-slug"],
            standalone_yaml={"my-kebab-slug": "Does something."},
            deep_agents={"my-kebab-slug": "system prompt content"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["name"] == "my-kebab-slug"

    def test_description_comes_from_standalone_yaml(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-agent"],
            standalone_yaml={"my-agent": "Standalone description text."},
            deep_agents={"my-agent": "system prompt"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["description"] == "Standalone description text."

    def test_system_prompt_comes_from_deep_agents_file(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["my-agent"],
            standalone_yaml={"my-agent": "Some description."},
            deep_agents={"my-agent": "The full persona system prompt."},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["system_prompt"] == "The full persona system prompt."

    def test_all_required_keys_present(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["agent-x"],
            standalone_yaml={"agent-x": "Desc."},
            deep_agents={"agent-x": "Prompt."},
        )
        result = load_subagents("pm", workspace_root=ws)
        entry = result[0]
        assert set(entry.keys()) >= {"name", "description", "system_prompt"}

    def test_accepts_string_workspace_root(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["agent-y"],
            standalone_yaml={"agent-y": "Desc."},
            deep_agents={"agent-y": "Prompt."},
        )
        result = load_subagents("pm", workspace_root=str(ws))
        assert len(result) == 1


# ---------------------------------------------------------------------------
# Empty / no-subagents cases
# ---------------------------------------------------------------------------

class TestNoSubagents:
    """Stages with no configured subagents return an empty list."""

    def test_developer_stage_has_no_subagents_key(self, tmp_path: Path):
        ws = _make_workspace(tmp_path)
        result = load_subagents("developer", workspace_root=ws)
        assert result == []

    def test_pm_stage_with_no_subagents_key_returns_empty(self, tmp_path: Path):
        # pm_subagents=None → key omitted from ledger YAML
        ws = _make_workspace(tmp_path, pm_subagents=None)
        result = load_subagents("pm", workspace_root=ws)
        assert result == []

    def test_unknown_stage_returns_empty_list(self, tmp_path: Path):
        """Stage not present in the manifest returns []."""
        ws = _make_workspace(tmp_path)
        result = load_subagents("nonexistent_stage", workspace_root=ws)
        assert result == []


# ---------------------------------------------------------------------------
# Cache behaviour
# ---------------------------------------------------------------------------

class TestCacheHit:
    """Second call returns cached content without re-reading the file."""

    def test_second_call_uses_cache(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["cached-agent"],
            standalone_yaml={"cached-agent": "Original description."},
            deep_agents={"cached-agent": "Original system prompt."},
        )
        first = load_subagents("pm", workspace_root=ws)

        # Overwrite both files on disk — cache should still return original content.
        (ws / "personas" / "standalone" / "src" / "meta" / "cached-agent.yaml").write_text(
            "slug: cached-agent\ndescription: \"CHANGED\"\n", encoding="utf-8"
        )
        (ws / "personas" / "standalone" / "deep-agents" / "cached-agent.md").write_text(
            "CHANGED PROMPT", encoding="utf-8"
        )
        second = load_subagents("pm", workspace_root=ws)

        assert first[0]["description"] == "Original description."
        assert second[0]["description"] == "Original description."
        assert first[0]["system_prompt"] == "Original system prompt."
        assert second[0]["system_prompt"] == "Original system prompt."


class TestCacheClear:
    """After clear_cache() the next load re-reads the files."""

    def test_clear_causes_reread(self, tmp_path: Path):
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["reload-agent"],
            standalone_yaml={"reload-agent": "v1 description."},
            deep_agents={"reload-agent": "v1 prompt"},
        )
        first = load_subagents("pm", workspace_root=ws)
        assert first[0]["description"] == "v1 description."

        # Update file content and clear the cache.
        (ws / "personas" / "standalone" / "src" / "meta" / "reload-agent.yaml").write_text(
            "slug: reload-agent\ndescription: \"v2 description.\"\n", encoding="utf-8"
        )
        (ws / "personas" / "standalone" / "deep-agents" / "reload-agent.md").write_text(
            "v2 prompt", encoding="utf-8"
        )
        clear_cache()

        second = load_subagents("pm", workspace_root=ws)
        assert second[0]["description"] == "v2 description."
        assert second[0]["system_prompt"] == "v2 prompt"


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------

class TestMissingStandaloneYaml:
    """Declared slug with no YAML in either suite raises FileNotFoundError."""

    def test_raises_file_not_found_for_missing_yaml(self, tmp_path: Path):
        # No YAML created for "ghost-agent" in either suite.
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["ghost-agent"],
        )
        with pytest.raises(FileNotFoundError, match="ghost-agent"):
            load_subagents("pm", workspace_root=ws)


class TestMissingDeepAgentsFile:
    """Declared slug where YAML exists but deep-agents file is absent in both suites."""

    def test_raises_file_not_found_for_missing_deep_agents(self, tmp_path: Path):
        # Standalone YAML exists but no deep-agents file in either suite.
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["half-agent"],
            standalone_yaml={"half-agent": "Has a description."},
            # deep_agents intentionally omitted for this slug
        )
        with pytest.raises(FileNotFoundError, match="half-agent"):
            load_subagents("pm", workspace_root=ws)


class TestMissingDescription:
    """Persona YAML that lacks a description field raises ValueError."""

    def test_raises_value_error_when_description_missing(self, tmp_path: Path):
        # Pass empty string as description → the helper omits the description field.
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["no-desc-agent"],
            standalone_yaml={"no-desc-agent": ""},   # empty → description field omitted
            deep_agents={"no-desc-agent": "Prompt content."},
        )
        with pytest.raises(ValueError, match="description"):
            load_subagents("pm", workspace_root=ws)


# ---------------------------------------------------------------------------
# Ledger-support suite resolution
# ---------------------------------------------------------------------------

class TestLedgerSupportSuiteResolution:
    """Subagent files in ledger-support suite are found before standalone."""

    def test_ledger_support_yaml_takes_precedence_over_standalone(self, tmp_path: Path):
        """When slug exists in both suites, ledger-support description wins."""
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["ledger-wp-decomposer"],
            standalone_yaml={"ledger-wp-decomposer": "Standalone description."},
            deep_agents={"ledger-wp-decomposer": "standalone prompt"},
            ledger_support_yaml={"ledger-wp-decomposer": "Ledger-support description."},
            ledger_support_deep_agents={"ledger-wp-decomposer": "ledger-support prompt"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["description"] == "Ledger-support description."
        assert result[0]["system_prompt"] == "ledger-support prompt"

    def test_falls_back_to_standalone_when_not_in_ledger_support(self, tmp_path: Path):
        """When slug only exists in standalone, standalone files are used."""
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["standalone-only-agent"],
            standalone_yaml={"standalone-only-agent": "Standalone only description."},
            deep_agents={"standalone-only-agent": "standalone only prompt"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert result[0]["description"] == "Standalone only description."
        assert result[0]["system_prompt"] == "standalone only prompt"

    def test_ledger_support_only_slug_resolves(self, tmp_path: Path):
        """When slug only exists in ledger-support, it resolves correctly."""
        ws = _make_workspace(
            tmp_path,
            pm_subagents=["ledger-support-only"],
            ledger_support_yaml={"ledger-support-only": "Ledger-support only desc."},
            ledger_support_deep_agents={"ledger-support-only": "ledger-support only prompt"},
        )
        result = load_subagents("pm", workspace_root=ws)
        assert len(result) == 1
        assert result[0]["description"] == "Ledger-support only desc."
        assert result[0]["system_prompt"] == "ledger-support only prompt"


# ---------------------------------------------------------------------------
# Integration test — real workspace
# ---------------------------------------------------------------------------

class TestRealWorkspace:
    """Integration tests against the actual workspace files."""

    def test_pm_returns_four_specs(self):
        """load_subagents('pm') on the real workspace returns 4 subagent specs."""
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        assert len(result) == 4

    def test_pm_specs_have_kebab_case_names(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            name = spec["name"]
            # kebab-case: only lowercase letters, digits, and hyphens
            assert name == name.lower(), f"Name {name!r} is not lowercase"
            assert " " not in name, f"Name {name!r} contains spaces"

    def test_pm_specs_have_descriptions_from_standalone_yaml(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            assert isinstance(spec["description"], str)
            assert len(spec["description"]) > 0

    def test_pm_specs_have_system_prompts_from_deep_agents(self):
        result = load_subagents("pm", workspace_root=_WORKSPACE_ROOT)
        for spec in result:
            assert isinstance(spec["system_prompt"], str)
            assert len(spec["system_prompt"]) > 0

    def test_developer_returns_empty_list(self):
        """load_subagents('developer') on the real workspace returns []."""
        result = load_subagents("developer", workspace_root=_WORKSPACE_ROOT)
        assert result == []
