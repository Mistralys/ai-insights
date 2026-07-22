"""
tests/test_persona_models_assignments.py — Assignments-layer tests for
extract_persona_model_slugs().

Covers:
- Priority chain: assignments.json persona_models > per-persona YAML > assignments
  default_model_uuid > _shared.yaml default_model_slug
- "inherit" slug is skipped; orchestrator falls back to YAML-based resolution
- assignments.json absent → YAML-only fallback (identical to pre-assignment behavior)
- local.json absent → UUID map is empty → assignments layer has no effect
- Partial assignments → only specified personas overridden; others fall back to YAML
- default_model_uuid override → applies to all unspecified personas
- Corrupt / invalid JSON files → graceful degradation to YAML-only behavior
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.utils.persona_models import extract_persona_model_slugs

# ---------------------------------------------------------------------------
# Deterministic UUIDs matching personas/model-registry/default.json
# ---------------------------------------------------------------------------
_UUID_INHERIT = "00000000-0000-0000-0000-000000000000"
_UUID_OPUS = "00000000-0000-0000-0000-000000000001"
_UUID_SONNET = "00000000-0000-0000-0000-000000000002"
_UUID_GEMINI = "00000000-0000-0000-0000-000000000003"
_UUID_UNKNOWN = "ffffffff-ffff-ffff-ffff-ffffffffffff"  # not in local.json

# ---------------------------------------------------------------------------
# Minimal workflow manifest (3 roles: planner=1, developer=2, synthesis=3)
# ---------------------------------------------------------------------------
_FIXTURE_MANIFEST = {
    "roles": [
        {"id": "planner", "number": 1, "name": "Planner"},
        {"id": "developer", "number": 2, "name": "Developer"},
        {"id": "synthesis", "number": 3, "name": "Synthesis"},
    ]
}

_DEFAULT_LOCAL_JSON = [
    {"id": _UUID_INHERIT, "name": "Inherit / Auto", "slug": "inherit", "cc_model": "inherit"},
    {"id": _UUID_OPUS, "name": "Claude Opus 4.6", "slug": "claude-opus-4-6", "cc_model": "inherit"},
    {"id": _UUID_SONNET, "name": "Claude Sonnet 4.6", "slug": "claude-sonnet-4-6", "cc_model": "inherit"},
    {"id": _UUID_GEMINI, "name": "Gemini 3.5 Flash", "slug": "gemini-3-5-flash", "cc_model": "gemini-3-5-flash"},
]


# ---------------------------------------------------------------------------
# Workspace builder
# ---------------------------------------------------------------------------

def _build_workspace(
    tmp_path: Path,
    personas: list[tuple[int, str | None]],
    *,
    default_slug: str = "claude-sonnet-4-6",
    manifest: dict | None = None,
    local_json: list | None | bool = None,
    assignments: dict | None | bool = None,
) -> Path:
    """Create a minimal workspace under *tmp_path*.

    Parameters
    ----------
    personas:
        List of ``(number, yaml_model_slug_or_None)`` tuples.  A YAML file is
        written for each entry.  ``None`` means no ``model_slug`` field.
    default_slug:
        Value of ``default_model_slug`` in ``_shared.yaml``.
    manifest:
        Workflow manifest dict.  Defaults to ``_FIXTURE_MANIFEST``.
    local_json:
        Model registry entries to write to ``local.json``.  Pass ``False`` to
        omit the file (tests the absent-file path).  Pass ``None`` to use the
        standard ``_DEFAULT_LOCAL_JSON`` fixture.
    assignments:
        Assignments dict to write to ``assignments.json``.  Pass ``False`` to
        omit the file (tests the absent-file path).  Pass ``None`` to omit
        (same as ``False``; default when not supplied).
    """
    meta_dir = tmp_path / "personas" / "ledger" / "src" / "meta"
    meta_dir.mkdir(parents=True)
    registry_dir = tmp_path / "personas" / "model-registry"
    registry_dir.mkdir(parents=True)
    shared_dir = tmp_path / "shared"
    shared_dir.mkdir()

    (meta_dir / "_shared.yaml").write_text(
        f'default_model_slug: "{default_slug}"\n',
        encoding="utf-8",
    )

    m = manifest if manifest is not None else _FIXTURE_MANIFEST
    (shared_dir / "workflow-manifest.json").write_text(
        json.dumps(m),
        encoding="utf-8",
    )

    for number, model_slug in personas:
        lines = [f"number: {number}\n"]
        if model_slug is not None:
            lines.append(f'model_slug: "{model_slug}"\n')
        (meta_dir / f"{number}-persona.yaml").write_text(
            "".join(lines),
            encoding="utf-8",
        )

    # Write local.json unless caller explicitly passes False.
    if local_json is not False:
        entries = _DEFAULT_LOCAL_JSON if local_json is None else local_json
        (registry_dir / "local.json").write_text(
            json.dumps(entries),
            encoding="utf-8",
        )

    # Write assignments.json only when a dict is passed.
    if isinstance(assignments, dict):
        (registry_dir / "assignments.json").write_text(
            json.dumps(assignments),
            encoding="utf-8",
        )

    return tmp_path


# ---------------------------------------------------------------------------
# Tests — assignments.json absent (YAML-only fallback)
# ---------------------------------------------------------------------------

class TestAssignmentsAbsent:
    """When assignments.json does not exist, behavior is identical to pre-assignment."""

    def test_all_stages_resolve_to_yaml_default(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result == {
            "planner": "claude-sonnet-4-6",
            "developer": "claude-sonnet-4-6",
            "synthesis": "claude-sonnet-4-6",
        }

    def test_per_persona_yaml_override_respected(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Tests — assignments present, full override
# ---------------------------------------------------------------------------

class TestAssignmentsPresentFullOverride:
    """assignments.json assigns every persona — all should use the assigned slug."""

    def test_all_stages_use_assigned_model(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_OPUS,
                    "developer": _UUID_GEMINI,
                    "synthesis": _UUID_OPUS,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "gemini-3-5-flash"
        assert result["synthesis"] == "claude-opus-4-6"

    def test_assignment_overrides_yaml_model_slug(self, tmp_path):
        """Assignment layer beats per-persona YAML model_slug."""
        ws = _build_workspace(
            tmp_path,
            # planner has YAML model_slug set to claude-opus-4-6
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_GEMINI,  # override via assignments
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "gemini-3-5-flash"

    def test_assignment_overrides_shared_yaml_default(self, tmp_path):
        """Assignment layer beats _shared.yaml default_model_slug."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_OPUS,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        # Unassigned stages still use the shared default.
        assert result["developer"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Tests — partial assignments
# ---------------------------------------------------------------------------

class TestPartialAssignments:
    """Only specified personas are overridden; others fall back to YAML."""

    def test_unassigned_stage_uses_yaml_model_slug(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_GEMINI,
                    # developer and synthesis NOT in assignments
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "gemini-3-5-flash"
        # developer has no YAML slug → falls to shared default
        assert result["developer"] == "claude-sonnet-4-6"

    def test_unassigned_stage_uses_shared_default(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_OPUS,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["developer"] == "claude-sonnet-4-6"
        assert result["synthesis"] == "claude-sonnet-4-6"

    def test_empty_persona_models_dict(self, tmp_path):
        """An assignments file with no persona entries is equivalent to absent."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={"persona_models": {}},
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Tests — "inherit" slug is skipped
# ---------------------------------------------------------------------------

class TestInheritSlugSkipped:
    """Orchestrator falls back to YAML when the resolved slug is 'inherit'."""

    def test_inherit_assignment_falls_back_to_yaml_slug(self, tmp_path):
        """Per-persona YAML slug is used when assignment resolves to 'inherit'."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_INHERIT,  # → slug "inherit" → skip
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        # Falls through to YAML layer (claude-opus-4-6)
        assert result["planner"] == "claude-opus-4-6"

    def test_inherit_assignment_falls_back_to_shared_default(self, tmp_path):
        """Shared YAML default used when assignment is 'inherit' and YAML has no slug."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_INHERIT,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-sonnet-4-6"

    def test_inherit_assignment_does_not_affect_other_stages(self, tmp_path):
        """An 'inherit' assignment for one stage leaves other stages unaffected."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_INHERIT,
                    "developer": _UUID_GEMINI,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-sonnet-4-6"  # fell back
        assert result["developer"] == "gemini-3-5-flash"  # used assignment


# ---------------------------------------------------------------------------
# Tests — default_model_uuid in assignments
# ---------------------------------------------------------------------------

class TestDefaultModelUuid:
    """assignments.json default_model_uuid overrides _shared.yaml default."""

    def test_default_uuid_applies_to_unassigned_stages(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "default_model_uuid": _UUID_GEMINI,
                "persona_models": {},
            },
        )
        result = extract_persona_model_slugs(ws)
        # All stages should use gemini (the assignment default)
        assert result["planner"] == "gemini-3-5-flash"
        assert result["developer"] == "gemini-3-5-flash"
        assert result["synthesis"] == "gemini-3-5-flash"

    def test_default_uuid_does_not_override_yaml_model_slug(self, tmp_path):
        """Per-persona YAML slug still wins over the default_model_uuid."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "default_model_uuid": _UUID_GEMINI,
                "persona_models": {},
            },
        )
        result = extract_persona_model_slugs(ws)
        # planner has explicit YAML → beats assignment default
        assert result["planner"] == "claude-opus-4-6"
        # developer has no YAML → gets assignment default
        assert result["developer"] == "gemini-3-5-flash"

    def test_per_persona_assignment_beats_default_uuid(self, tmp_path):
        """Explicit per-persona assignment takes precedence over default_model_uuid."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "default_model_uuid": _UUID_GEMINI,
                "persona_models": {
                    "planner": _UUID_OPUS,  # explicit → wins
                },
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "gemini-3-5-flash"

    def test_inherit_default_uuid_is_skipped(self, tmp_path):
        """When default_model_uuid resolves to 'inherit', shared YAML default is used."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "default_model_uuid": _UUID_INHERIT,
                "persona_models": {},
            },
        )
        result = extract_persona_model_slugs(ws)
        # inherit is skipped → fall back to _shared.yaml
        assert result["planner"] == "claude-sonnet-4-6"
        assert result["developer"] == "claude-sonnet-4-6"


# ---------------------------------------------------------------------------
# Tests — graceful degradation on bad/missing files
# ---------------------------------------------------------------------------

class TestGracefulDegradation:
    """Corrupt or absent registry files degrade gracefully to YAML-only behavior."""

    def test_local_json_absent_assignments_ignored(self, tmp_path):
        """Without local.json the UUID map is empty — assignments have no effect."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            local_json=False,  # omit local.json
            assignments={
                "persona_models": {
                    "planner": _UUID_GEMINI,
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        # UUID cannot be resolved → assignment ignored → falls to YAML slug
        assert result["planner"] == "claude-opus-4-6"

    def test_assignments_invalid_json_falls_back_to_yaml(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        # Overwrite assignments.json with invalid JSON.
        registry_dir = ws / "personas" / "model-registry"
        (registry_dir / "assignments.json").write_text(
            "THIS IS NOT JSON",
            encoding="utf-8",
        )
        result = extract_persona_model_slugs(ws)
        # Graceful fallback → YAML resolution
        assert result["planner"] == "claude-opus-4-6"
        assert result["developer"] == "claude-sonnet-4-6"

    def test_local_json_invalid_json_uuid_map_empty(self, tmp_path):
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            local_json=False,  # we'll write it manually
            assignments={
                "persona_models": {
                    "planner": _UUID_OPUS,
                }
            },
        )
        registry_dir = ws / "personas" / "model-registry"
        (registry_dir / "local.json").write_text("INVALID JSON", encoding="utf-8")
        result = extract_persona_model_slugs(ws)
        # UUID map build failed → assignment layer has no effect → shared default
        assert result["planner"] == "claude-sonnet-4-6"

    def test_assignments_is_json_array_falls_back(self, tmp_path):
        """assignments.json that is a JSON array (not object) is treated as invalid."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
        )
        registry_dir = ws / "personas" / "model-registry"
        (registry_dir / "assignments.json").write_text(
            json.dumps([1, 2, 3]),
            encoding="utf-8",
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-sonnet-4-6"

    def test_unknown_uuid_in_assignment_is_skipped(self, tmp_path):
        """A UUID that doesn't appear in local.json is treated as unresolvable."""
        ws = _build_workspace(
            tmp_path,
            [(1, "claude-opus-4-6"), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={
                "persona_models": {
                    "planner": _UUID_UNKNOWN,  # not in local.json
                }
            },
        )
        result = extract_persona_model_slugs(ws)
        # Unresolvable UUID → skip assignment → use YAML slug
        assert result["planner"] == "claude-opus-4-6"


# ---------------------------------------------------------------------------
# Tests — priority chain completeness
# ---------------------------------------------------------------------------

class TestPriorityChain:
    """Verify the complete four-layer priority chain in a single workspace."""

    def test_full_priority_chain(self, tmp_path):
        """
        Layer precedence:
          per-persona assignment > YAML model_slug > default_model_uuid > shared default

        persona 1 (planner): assignment → claude-opus-4-6  (beats YAML & default)
        persona 2 (developer): no assignment, YAML slug → claude-opus-4-6  (beats default_uuid & shared)
        persona 3 (synthesis): no assignment, no YAML slug → default_uuid → gemini-3-5-flash
        """
        ws = _build_workspace(
            tmp_path,
            [
                (1, "claude-sonnet-4-6"),  # YAML slug — will be beaten by assignment
                (2, "claude-opus-4-6"),    # YAML slug — no assignment, wins over default_uuid
                (3, None),                 # no YAML slug — gets default_uuid
            ],
            default_slug="claude-sonnet-4-6",
            assignments={
                "default_model_uuid": _UUID_GEMINI,
                "persona_models": {
                    "planner": _UUID_OPUS,  # assignment beats YAML
                    # developer NOT in assignments → falls to YAML
                    # synthesis NOT in assignments → falls to default_uuid
                },
            },
        )
        result = extract_persona_model_slugs(ws)
        assert result["planner"] == "claude-opus-4-6"      # Layer 1: assignment
        assert result["developer"] == "claude-opus-4-6"    # Layer 2: YAML slug
        assert result["synthesis"] == "gemini-3-5-flash"   # Layer 3: default_uuid

    def test_shared_default_is_last_resort(self, tmp_path):
        """When layers 1–3 all produce nothing, shared default is used."""
        ws = _build_workspace(
            tmp_path,
            [(1, None), (2, None), (3, None)],
            default_slug="claude-sonnet-4-6",
            assignments={"persona_models": {}},  # no per-persona assignments, no default_uuid
        )
        result = extract_persona_model_slugs(ws)
        for slug in result.values():
            assert slug == "claude-sonnet-4-6"
