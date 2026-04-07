"""
utils/persona_models.py — Per-stage model slug extractor.

Reads persona YAML metadata files from ``personas/ledger/src/meta/`` and
returns the API-compatible model identifier for each orchestrator stage.

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


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_persona_model_slugs(workspace_root: Path | str) -> dict[str, str]:
    """Read persona YAML metadata and return ``{stage_id: model_slug}``.

    The ``model_slug`` for each stage is resolved as follows:

    1. Use the per-persona ``model_slug`` field if present.
    2. Fall back to ``default_model_slug`` from ``_shared.yaml``.

    Parameters
    ----------
    workspace_root:
        Path to the monorepo workspace root.  The metadata directory
        ``personas/ledger/src/meta/`` and the shared manifest
        ``shared/workflow-manifest.json`` are resolved relative to this path.

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
    # 2. Build number → stage_id from the shared workflow manifest.
    # ------------------------------------------------------------------
    manifest_path = workspace_root / _MANIFEST_RELATIVE
    manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
    if "roles" not in manifest_data:
        raise ValueError(
            f"'roles' key missing from {manifest_path}. "
            "Ensure shared/workflow-manifest.json is valid."
        )
    number_to_id: dict[int, str] = {
        r["number"]: r["id"] for r in manifest_data["roles"]
    }

    # ------------------------------------------------------------------
    # 3. Scan per-persona YAML files (e.g. 1-planner.yaml … 9-synthesis.yaml).
    # ------------------------------------------------------------------
    result: dict[str, str] = {}
    for yaml_file in sorted(meta_dir.glob("[1-9]-*.yaml")):
        text = yaml_file.read_text(encoding="utf-8")

        number_str = _extract_yaml_scalar(text, "number")
        if number_str is None:
            log.warning("Skipping %s: no 'number' field found.", yaml_file.name)
            continue
        try:
            number = int(number_str)
        except ValueError:
            log.warning(
                "Skipping %s: 'number' is not an integer: %r.",
                yaml_file.name,
                number_str,
            )
            continue

        stage_id = number_to_id.get(number)
        if stage_id is None:
            log.warning(
                "Skipping %s: number %d not in workflow manifest.",
                yaml_file.name,
                number,
            )
            continue

        model_slug = _extract_yaml_scalar(text, "model_slug") or default_slug
        result[stage_id] = model_slug
        log.debug(
            "Stage %r → model slug %r (from %s).",
            stage_id,
            model_slug,
            yaml_file.name,
        )

    return result
