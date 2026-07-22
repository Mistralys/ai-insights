"""
utils/persona_models.py — Per-stage model slug extractor.

Reads persona YAML metadata files from ``personas/ledger/src/meta/`` and
returns the API-compatible model identifier for each orchestrator stage.

Model resolution follows a four-layer priority chain for each stage:

1. ``personas/model-registry/assignments.json`` ``persona_models[stage_id]``
   UUID resolved via ``local.json`` — skipped when the resolved slug is
   ``"inherit"`` (the orchestrator always requires a concrete slug for API
   calls).
2. Per-persona ``model_slug`` field from the ledger YAML file.
3. ``assignments.json`` ``default_model_uuid`` resolved via ``local.json`` —
   skipped when the resolved slug is ``"inherit"``.
4. ``default_model_slug`` from ``_shared.yaml``.

When ``assignments.json`` or ``local.json`` are absent or unreadable, layers
1 and 3 are silently bypassed and resolution falls through to the YAML-only
layers, preserving backward compatibility.

Example::

    slugs = extract_persona_model_slugs(workspace_root)
    # → {"planner": "claude-opus-4-6", "developer": "claude-sonnet-4-6", ...}
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

log = logging.getLogger(__name__)

# Paths relative to workspace root.
_META_DIR_RELATIVE = Path("personas") / "ledger" / "src" / "meta"
_MANIFEST_RELATIVE = Path("shared") / "workflow-manifest.json"
_REGISTRY_DIR_RELATIVE = Path("personas") / "model-registry"

# Sentinel slug that tells the orchestrator to skip the assignment override.
_INHERIT_SLUG = "inherit"


# ---------------------------------------------------------------------------
# Internal YAML helpers (stdlib-only — handles only simple scalar fields)
# ---------------------------------------------------------------------------

def _strip_inline_comment(raw: str) -> str:
    """Remove a YAML inline comment from *raw*, respecting quoted values.

    Scans *raw* left-to-right.  A ``#`` character that is not enclosed in
    single or double quotes terminates the value; everything from that ``#``
    onward (including surrounding whitespace) is discarded.
    """
    in_quote: str | None = None
    for i, ch in enumerate(raw):
        if ch in ('"', "'"):
            if in_quote is None:
                in_quote = ch
            elif in_quote == ch:
                in_quote = None
        elif ch == "#" and in_quote is None:
            return raw[:i].rstrip()
    return raw


def _extract_yaml_scalar(text: str, key: str) -> str | None:
    """Return the top-level scalar value for *key* from simple YAML *text*.

    Returns ``None`` if the key is absent.  Only top-level ``key: value``
    lines are considered; nested structures, multi-line values, and YAML
    anchors are not supported — the persona metadata files only use simple
    scalars for the fields this module needs.

    Inline comments and surrounding quotes (single or double) are stripped
    from the returned value.
    """
    prefix = f"{key}:"
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith(prefix):
            raw = stripped[len(prefix):].strip()
            raw = _strip_inline_comment(raw).strip()
            # Strip surrounding quotes.
            if len(raw) >= 2 and raw[0] in ('"', "'") and raw[-1] == raw[0]:
                raw = raw[1:-1]
            return raw
    return None


def _extract_yaml_list(text: str, key: str) -> list[str]:
    """Return the list of simple scalar items under *key* from YAML *text*.

    Handles the pattern::

        key:
          - item1
          - item2

    Returns an empty list if the key is absent or has no list items.
    Only top-level keys are considered.  Items must be simple scalars (not
    nested structures).  Inline comments and surrounding quotes (single or
    double) are stripped from each item.

    If the key is found but has an inline scalar value (e.g. ``key: value``)
    rather than a block list, an empty list is returned.
    """
    prefix = f"{key}:"
    collecting = False
    result: list[str] = []

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith(prefix):
            remainder = stripped[len(prefix):].strip()
            remainder = _strip_inline_comment(remainder).strip()
            if not remainder:
                collecting = True
                continue
            # Inline scalar value — not a block list.
            return []
        if collecting:
            if stripped.startswith("- "):
                val = stripped[2:].strip()
                val = _strip_inline_comment(val).strip()
                if len(val) >= 2 and val[0] in ('"', "'") and val[-1] == val[0]:
                    val = val[1:-1]
                result.append(val)
            elif stripped == "-":
                # bare dash with no value — append empty string
                result.append("")
            else:
                # Next top-level key encountered — stop collecting.
                break

    return result


# ---------------------------------------------------------------------------
# Model-registry helpers (assignments.json / local.json)
# ---------------------------------------------------------------------------

def _read_uuid_to_slug_map(workspace_root: Path) -> dict[str, str]:
    """Build a UUID → slug map from ``personas/model-registry/local.json``.

    Returns an empty dict if the file is absent, unreadable, or invalid JSON.
    Entries that lack both ``id`` and ``slug`` fields are silently skipped.

    Note
    ----
    ``local.json`` is machine-generated and expected to contain unique UUIDs.
    If duplicate ``id`` values appear, the last entry wins (dict comprehension
    last-write-wins).  This is benign in practice but worth noting if the file
    ever becomes hand-editable.
    """
    local_path = workspace_root / _REGISTRY_DIR_RELATIVE / "local.json"
    if not local_path.is_file():
        return {}
    try:
        entries = json.loads(local_path.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            log.debug("local.json is not a JSON array — skipping UUID map build.")
            return {}
        return {
            e["id"]: e["slug"]
            for e in entries
            if isinstance(e, dict) and "id" in e and "slug" in e
        }
    except (OSError, ValueError) as exc:
        log.debug("Could not read local.json for UUID-to-slug map: %s", exc)
        return {}


def _read_assignments(workspace_root: Path) -> dict | None:
    """Read ``personas/model-registry/assignments.json``.

    Returns the parsed dict on success, or ``None`` if the file is absent,
    unreadable, or does not contain a valid JSON object with the expected shape.
    """
    assignments_path = workspace_root / _REGISTRY_DIR_RELATIVE / "assignments.json"
    if not assignments_path.is_file():
        log.debug("assignments.json not found — using YAML-only model resolution.")
        return None
    try:
        data = json.loads(assignments_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.debug("Could not read assignments.json: %s — using YAML-only fallback.", exc)
        return None
    if not isinstance(data, dict):
        log.debug("assignments.json is not a JSON object — using YAML-only fallback.")
        return None
    return data


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def find_ledger_yaml_for_stage(
    stage_id: str,
    workspace_root: Path | str,
) -> tuple[Path, str] | None:
    """Locate the ledger persona YAML file for *stage_id*.

    Reads ``shared/workflow-manifest.json`` to map *stage_id* to a role
    number, then scans ``personas/ledger/src/meta/`` for the matching file.

    Returns a ``(yaml_path, yaml_text)`` tuple, or ``None`` if no matching
    file is found or *stage_id* is not in the manifest.

    Notes
    -----
    The glob pattern ``[1-9]-*.yaml`` only matches files with a **single-digit**
    numeric prefix (i.e. role numbers 1–9).  If a tenth role is ever added with
    a two-digit prefix it will be silently skipped.
    """
    workspace_root = Path(workspace_root)
    meta_dir = workspace_root / _META_DIR_RELATIVE
    manifest_path = workspace_root / _MANIFEST_RELATIVE

    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    id_to_number: dict[str, int] = {
        r["id"]: r["number"] for r in manifest_data.get("roles", [])
    }

    target_number = id_to_number.get(stage_id)
    if target_number is None:
        return None

    for yaml_file in sorted(meta_dir.glob("[1-9]-*.yaml")):
        text = yaml_file.read_text(encoding="utf-8")
        number_str = _extract_yaml_scalar(text, "number")
        if number_str is None:
            continue
        try:
            if int(number_str) == target_number:
                return (yaml_file, text)
        except ValueError:
            continue

    return None


def extract_persona_model_slugs(workspace_root: Path | str) -> dict[str, str]:
    """Read persona YAML metadata and return ``{stage_id: model_slug}``.

    The ``model_slug`` for each stage is resolved via a four-layer priority
    chain:

    1. ``assignments.json`` ``persona_models[stage_id]`` UUID resolved to a
       slug via ``local.json`` — **skipped** when the resolved slug is
       ``"inherit"`` (the orchestrator always needs a concrete model slug for
       API calls; ``"inherit"`` is an IDE-only sentinel).
    2. Per-persona ``model_slug`` field from the ledger YAML file.
    3. ``assignments.json`` ``default_model_uuid`` resolved to a slug via
       ``local.json`` — **skipped** when the resolved slug is ``"inherit"``.
    4. ``default_model_slug`` from ``_shared.yaml``.

    When ``assignments.json`` or ``local.json`` are absent or unreadable,
    layers 1 and 3 are silently skipped and resolution falls through to the
    YAML-only layers (identical to the pre-assignments behavior).

    Parameters
    ----------
    workspace_root:
        Path to the monorepo workspace root.  The metadata directory
        ``personas/ledger/src/meta/``, the shared manifest
        ``shared/workflow-manifest.json``, and the model-registry directory
        ``personas/model-registry/`` are resolved relative to this path.

    Returns
    -------
    dict[str, str]
        Mapping of stage ID (e.g. ``"developer"``) → API model slug (e.g.
        ``"claude-sonnet-4-6"``).  Contains one entry per role defined in the
        shared workflow manifest that has a matching persona YAML file.

    Raises
    ------
    OSError
        If the persona metadata directory does not exist.
    FileNotFoundError
        If ``_shared.yaml`` or ``workflow-manifest.json`` is missing.
    ValueError
        If ``default_model_slug`` is absent from ``_shared.yaml``.

    Notes
    -----
    For the full priority-chain narrative and graceful-fallback behaviour when
    ``assignments.json`` or ``local.json`` are absent, see the **module
    docstring** at the top of ``persona_models.py``.

    The glob pattern ``[1-9]-*.yaml`` only matches files with a **single-digit**
    numeric prefix (i.e. role numbers 1–9). If a tenth role is ever added with a
    two-digit prefix (e.g. ``10-new-role.yaml``), it will be **silently skipped**
    by this function. Update the pattern in ``_META_DIR_RELATIVE`` glob call if
    the total number of roles exceeds 9.
    """
    workspace_root = Path(workspace_root)
    meta_dir = workspace_root / _META_DIR_RELATIVE

    if not meta_dir.is_dir():
        raise OSError(
            f"Persona metadata directory not found: {meta_dir}. "
            "Ensure the workspace is fully checked out."
        )

    # ------------------------------------------------------------------
    # 1. Load default_model_slug from _shared.yaml.
    # ------------------------------------------------------------------
    shared_path = meta_dir / "_shared.yaml"
    shared_text = shared_path.read_text(encoding="utf-8")
    default_slug = _extract_yaml_scalar(shared_text, "default_model_slug")
    if default_slug is None:
        raise ValueError(
            f"'default_model_slug' not found in {shared_path}. "
            "Ensure WP-001 persona metadata changes are in place."
        )

    # ------------------------------------------------------------------
    # 2. Collect all stage IDs from the shared workflow manifest.
    # ------------------------------------------------------------------
    manifest_path = workspace_root / _MANIFEST_RELATIVE
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if "roles" not in manifest_data:
        raise ValueError(
            f"'roles' key missing from {manifest_path}. "
            "Ensure shared/workflow-manifest.json is valid."
        )
    stage_ids = [r["id"] for r in manifest_data["roles"]]

    # ------------------------------------------------------------------
    # 3. Load assignments and UUID-to-slug map (graceful — may be absent).
    # ------------------------------------------------------------------
    uuid_to_slug = _read_uuid_to_slug_map(workspace_root)
    assignments = _read_assignments(workspace_root)
    persona_models: dict[str, str] = {}
    default_assignment_slug: str | None = None

    if assignments is not None:
        raw_persona_models = assignments.get("persona_models", {})
        if isinstance(raw_persona_models, dict):
            persona_models = raw_persona_models

        default_uuid = assignments.get("default_model_uuid")
        if default_uuid and isinstance(default_uuid, str):
            resolved = uuid_to_slug.get(default_uuid)
            if resolved and resolved != _INHERIT_SLUG:
                default_assignment_slug = resolved
                log.debug(
                    "Assignments default model UUID %r → slug %r.",
                    default_uuid,
                    resolved,
                )
            elif resolved == _INHERIT_SLUG:
                log.debug(
                    "Assignments default model UUID %r resolves to 'inherit' "
                    "— skipping default assignment override.",
                    default_uuid,
                )

    # Effective default: assignment default (if any) overrides _shared.yaml.
    effective_default = default_assignment_slug or default_slug

    # ------------------------------------------------------------------
    # 4. For each stage, locate its persona YAML and resolve model_slug.
    # ------------------------------------------------------------------
    result: dict[str, str] = {}
    for stage_id in stage_ids:
        found = find_ledger_yaml_for_stage(stage_id, workspace_root)
        if found is None:
            log.warning("No persona YAML found for stage %r — skipping.", stage_id)
            continue
        yaml_file, text = found

        # Layer 1: per-persona assignment from assignments.json.
        assignment_uuid = persona_models.get(stage_id)
        assignment_slug: str | None = None
        if assignment_uuid and isinstance(assignment_uuid, str):
            resolved = uuid_to_slug.get(assignment_uuid)
            if resolved and resolved != _INHERIT_SLUG:
                assignment_slug = resolved
                log.debug(
                    "Stage %r → assignment UUID %r resolved to slug %r.",
                    stage_id,
                    assignment_uuid,
                    resolved,
                )
            elif resolved == _INHERIT_SLUG:
                log.debug(
                    "Stage %r → assignment UUID %r resolves to 'inherit' "
                    "— skipping per-persona assignment override.",
                    stage_id,
                    assignment_uuid,
                )

        # Layer 2: per-persona YAML model_slug.
        yaml_slug = _extract_yaml_scalar(text, "model_slug")

        # Apply priority chain: assignment > yaml > effective_default.
        model_slug = assignment_slug or yaml_slug or effective_default
        result[stage_id] = model_slug
        log.debug(
            "Stage %r → model slug %r (from %s).",
            stage_id,
            model_slug,
            yaml_file.name,
        )

    return result
