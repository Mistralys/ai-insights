# Synthesis Report — Per-Stage Model Configuration

**Date:** 2026-04-07  
**Plan:** `2026-04-07-per-stage-model-config`  
**Status:** COMPLETE  
**Duration:** ~67 minutes (15:39 → 16:46 UTC)

---

## Executive Summary

This session replaced the orchestrator's global `MODEL_NAME` / `--model` configuration channel with persona-metadata-driven per-stage model selection. The change closes the architectural gap between what the persona YAML files declared (per-agent model intent) and what the orchestrator actually used (a single environment variable that could contradict it).

A new `model_slug` field in each persona's YAML source carries the API-compatible model identifier (e.g. `claude-opus-4-6`). A `default_model_slug` in `_shared.yaml` covers the seven agents that share the default. A new `extract_persona_model_slugs()` utility reads these values at orchestrator startup, populates `Config.stage_models`, and every stage node resolves its own model via `Config.resolve_model_for_stage(stage)` before calling `create_deep_agent()`. Model selection is now defined once in persona metadata and consumed everywhere — no env var, no CLI flag, no mapping layer.

All five work packages completed with no rework loops. The full test suite grew from 745 to 770 passing tests with 0 failures.

---

## Work Package Summary

| WP | Title | Pipelines | Key Deliverables |
|----|-------|-----------|-----------------|
| WP-001 | Persona metadata — add `model_slug` / `default_model_slug` | impl → qa → code-review → docs | `_shared.yaml`, `1-planner.yaml`, `2-project-manager.yaml`, ledger plugin fallback, manifest docs |
| WP-002 | `extract_persona_model_slugs()` utility | impl → qa → code-review → docs | New `orchestrator/src/utils/persona_models.py` + 27 tests; orchestrator api-surface docs |
| WP-003 | Refactor `Config` — remove MODEL_NAME, add `stage_models` | impl → qa → security-audit → code-review → docs | `config.py`, `cli.py`, `nodes/__init__.py`, `logging.py`, 5 test files; orchestrator README + public-api + jsonl-log-schema |
| WP-004 | JSONL observability — `model` on stage events | impl → qa → code-review → docs | All stage events now include `model` field; parametrized test coverage; architecture.md / api-surface.md patched |
| WP-005 | Documentation sweep | docs only | `AGENTS.md` cross-system deps, orchestrator constraints constraint #18, `read-log.js` model tag rendering |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tests passed (full suite, final) | **770** |
| Tests failed | 0 |
| Tests skipped | 6 |
| Net new tests added | +25 (27 in WP-002; −13 replaced, +13 new in WP-003; +2 parametrized in WP-004) |
| Security issues (Critical / High / Medium) | **0 / 0 / 0** |
| Rework loops | **0** |
| Revision count (all WPs) | 0 |
| Reviewer Fix-Forwards applied | 4 |
| Documentation-Forwards resolved | 5 |
| Files modified (source) | 15 |
| Files modified (docs/tests) | 12 |

---

## Reviewer Fix-Forwards Applied

These improvements were applied directly by the Reviewer during code review, without requiring an implementation rework loop:

1. **WP-002 — `ValueError` guard for missing `roles` key** (`persona_models.py`): Converts an obscure `KeyError: 'roles'` on a malformed `workflow-manifest.json` into a descriptive `ValueError` with the offending file path.

2. **WP-003 — `.strip()` on API key env reads** (`config.py`): `bool(os.environ.get('ANTHROPIC_API_KEY', '').strip())` — whitespace-only values no longer silently pass pre-flight validation and fail later at the first API call with an authentication error. Aligned with the Security Auditor's A02/A07 observation.

3. **WP-004 — Intentionality comment above `resolve_model_for_stage()`** (`nodes/__init__.py`): Three-line comment explaining why the call sits before the `try` block (a programming-error `KeyError` must propagate, not become a `stage_error` log entry).

4. **WP-004 — Parametrize `test_stage_error_log_contains_model_field`** (`test_nodes.py`): Extended from developer-only to all 6 node types, matching the coverage pattern of the `stage_start` and `stage_complete` model field tests.

---

## Security Review

WP-003 was the only WP to include a dedicated security audit pipeline. The Security Auditor reviewed five modified source files against all 10 OWASP categories and found **0 Critical, 0 High, 0 Medium** findings. Two low/info observations were recorded:

- **A02/A07** — whitespace-only API key values would pass the `bool(os.environ.get(...))` guard and fail later. Remediated by the Reviewer via Fix-Forward (`.strip()`).
- **A03** — `model_slug` flows into `create_deep_agent(model=...)` as an HTTP JSON body field (no shell/URL injection surface). Documented for future maintainers: if the slug ever flows into a subprocess or URL outside the SDK, an allowlist check should be added at that boundary.
- **A09** — The new `stage_models` JSONL field contains slug strings only, no credentials. Confirmed safe.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. The architecture is now self-consistent by design

Model selection is no longer a parallel configuration concern. Persona metadata declares intent; the orchestrator reads that intent directly at startup. If the model for a stage changes (e.g., Planner switches to a new model slug), updating `1-planner.yaml` is the only change needed. No `orchestrator/.env` edits, no CLI flags, no cross-project synchronisation ceremonies.

### 2. Add a startup assertion: `len(stage_models) == 9`

Three agents independently flagged that `extract_persona_model_slugs()` silently returns a smaller dict if a persona YAML file is missing (it logs a warning and skips). A one-line assertion in `load_config()` — `assert len(stage_models) == 9, f"Expected 9 stage models, got {len(stage_models)}"` — would surface this failure loudly at startup rather than at the first deep agent call. This defensive guard costs nothing and prevents a class of silent misconfiguration bugs.

### 3. Document the `[1-9]-*.yaml` glob constraint as a known scaling limit

The `extract_persona_model_slugs()` glob pattern (`[1-9]-*.yaml`) only matches single-digit role file prefixes. This was flagged by the Reviewer and addressed in the docstring and `api-surface.md`. However, this constraint is worth noting explicitly: any project expansion beyond 9 roles requires updating the glob pattern before the 10th role will be picked up. The current constraint file entry (#18) is the right place to monitor this.

### 4. Consider a `applyFallbacks()` helper in the ledger plugin

The `personas/plugins/ledger/index.js` `onBuildContext()` function now has two parallel fallback blocks: `model → default_model` and `model_slug → default_model_slug`. If a third fallback pair is ever added, a small `applyFallbacks(ctx, pairs)` helper would keep the function scannable. Deferred appropriately by the Developer — current size is not a maintenance concern — but worth flagging for the next persona metadata field addition.

### 5. The stdlib-only YAML parser is the right trade-off here

Adding PyYAML solely to parse two scalar fields from persona metadata would be over-engineering. The `_extract_yaml_scalar()` / `_strip_inline_comment()` helpers are simple, well-tested (13 unit tests), and correctly scoped. The one edge case left open — explicit `model_slug: ""` treated the same as absent — is handled by the `or`-based fallback and is not a real-world concern given no current persona uses an empty slug.

---

## Next Steps for Planner / PM

1. **Orchestrator changelog** — Add a `v0.x.0` entry to `orchestrator/changelog.md` covering the model selection refactor, then update the root `changelog.md` with the next workspace-level version.

2. **Preflight script update** — `scripts/preflight-orchestrator.js` may still reference `MODEL_NAME` in its validation logic or output. Verify and remove if so.

3. **AGENTS.md — Orchestrator model slugs dependency** — The new cross-system dependency row was added to `AGENTS.md` in WP-005. Confirm the `orchestrator/src/config.py → Config.stage_models` chain is correctly reflected in the run-time tracing section if one exists.

4. **`[1-9]-*.yaml` glob future-proofing** — If a 10th role is added to the workflow manifest, update the glob pattern in `extract_persona_model_slugs()` before creating the 10th persona YAML file.

5. **`test_stage_error_log_contains_model_field` coverage** — The Reviewer parametrized this test across all 6 node types in WP-004. Confirm the full 18-test parametrized suite is visible in CI output and not accidentally deduplicated.
