# Project Synthesis — Persona Model Field Rework

**Plan:** `2026-03-12-persona-model-field-rework`
**Date:** 2026-03-12
**Status:** COMPLETE
**Synthesized by:** Head of Operations (Synthesis Agent)

---

## Executive Summary

This project introduced first-class `model` field support to the ledger persona build system. Every generated ledger persona frontmatter now includes a `model:` line pointing to the correctly resolved Claude model.

The implementation follows a two-tier override pattern that mirrors the existing `default_version`/`version` convention:

- **Agents 1–2** (Planner, Project Manager) → `Claude Opus 4.6` via per-persona YAML override
- **Agents 3–7** (Developer through Synthesis) → `Claude Sonnet 4.6` via `default_model` in `_shared.yaml`

The resolution chain in `buildForTarget()` is: `persona.model → default_model || cc_model || 'inherit'`. The `ccModel` value is derived from the resolved model (not a static passthrough), ensuring CC frontmatter stays in sync with VS Code frontmatter for all 14 ledger personas across both IDE targets.

The standalone suite is **entirely unaffected** — it retains `model: 'inherit'` via the existing `cc_model` fallback (no `default_model` in standalone `_shared.yaml`).

---

## Work Package Summary

| WP | Title | Status | Key Output |
|----|-------|--------|------------|
| WP-001 | YAML Metadata — Add model fields | COMPLETE ✅ | `default_model` in `_shared.yaml`; `model: "Claude Opus 4.6"` in 1-planner.yaml and 2-project-manager.yaml |
| WP-002 | Build Script Integration | COMPLETE ✅ | `buildForTarget()` model resolution chain; `model: '{{model}}'` in `FRONTMATTER_LEDGER_VSCODE`; unified `ccModel` derivation |
| WP-003 | Manifest Documentation | COMPLETE ✅ | `api-surface.md`, `data-flows.md`, `constraints.md` updated with new fields, resolution chain, and constraints 26b/26c |
| WP-004 | Build Verification + Changelog | COMPLETE ✅ | `--suite ledger --strict` exit 0; all 14 generated files verified; v3.7.3 changelog entry written |
| WP-005 | Sync and Deploy | COMPLETE ✅ | 36 personas deployed (14 ledger + 22 standalone) to VS Code prompts and `~/.claude/agents/`; `personas/package.json` bumped to v3.7.3 |

---

## Metrics

| WP | Tests Passed | Tests Failed | Coverage |
|----|-------------|-------------|----------|
| WP-001 | 14 (build --check, 14 ledger personas) | 0 | YAML metadata, AC verification |
| WP-002 | 36 (14 ledger + 22 standalone all up-to-date) | 0 | Build script + template integration |
| WP-003 | 9 (9 AC criteria verified) | 0 | Manifest doc accuracy |
| WP-004 | 5 (5 AC criteria: strict build, model values, no markers, standalone) | 0 | End-to-end build verification |
| WP-005 | 7 (sync + deploy, model assignment verification, no markers, standalone regression) | 0 | End-to-end deploy verification |
| **Total** | **71** | **0** | — |

**Pipeline Health:** 5/5 WPs passed all 4 pipeline stages (implementation → qa → code-review → documentation). Zero FAIL pipelines.

---

## Artifacts Modified

| File | Change |
|------|--------|
| `personas/ledger/src/meta/_shared.yaml` | Added `default_model: "Claude Sonnet 4.6"` after `default_version` |
| `personas/ledger/src/meta/1-planner.yaml` | Added `model: "Claude Opus 4.6"` after `role` |
| `personas/ledger/src/meta/2-project-manager.yaml` | Added `model: "Claude Opus 4.6"` after `role` |
| `scripts/build-personas.js` | Added model resolution logic, `ccModel` derivation, `model: '{{model}}'` to `FRONTMATTER_LEDGER_VSCODE` |
| `personas/docs/agents/project-manifest/api-surface.md` | Added `default_model`, `model`, `{{model}}`, `{{cc_model}}` entries; updated FRONTMATTER template |
| `personas/docs/agents/project-manifest/data-flows.md` | Added `default_model` in Layer 1; `model` and updated `cc_model` in Layer 3; fixed `??` → `!== undefined` notation; added `// overridden in Layer 3` annotation to cc_model in Layer 1 |
| `personas/docs/agents/project-manifest/constraints.md` | Added constraints 26b, 26c; updated constraint 31 to name `validateVSCodeFrontmatter()`, add `id`, and flag the `model` validation gap |
| `personas/changelog.md` | v3.7.3 entry documenting all changes |
| `personas/package.json` | Bumped to v3.7.3 (via `sync-personas.js`) |

---

## Strategic Recommendations (Gold Nuggets)

### High Priority
_None — no blocking issues found across any pipeline stage._

### Medium Priority

1. **Add `model` validation to VS Code frontmatter validator** — `validateVSCodeFrontmatter()` (constraint 31) checks `role`, `name`, `id`, and `vs_file_name` but not `model`. The CC validator already validates `model`. Adding the same check to the VS Code validator would catch accidental template omission in future. Low effort, high debuggability gain.

2. **Add `console.warn` for `'inherit'` fallback in ledger builds** — If `_shared.yaml` is ever misconfigured (e.g., `default_model` accidentally removed), the fallback silently reaches `'inherit'`, producing incorrect frontmatter in all ledger personas. A warning log at that point would surface the misconfiguration immediately instead of requiring a visual inspection of generated files.

### Low Priority (Non-Blocking)

3. **Inline comment on the `cc_model` mid-level fallback** — `scripts/build-personas.js` ~L574: the chain `sharedMeta.default_model || sharedMeta.cc_model || 'inherit'` uses `cc_model` as a middle fallback to bridge configs that only have `cc_model` without `default_model`. A one-line comment here would reduce the learning curve for future maintainers. Raised by Developer, echoed by Reviewer and Reviewer (WP-004) — three independent observers agree.

4. **Context object consolidation** — `scripts/build-personas.js` ~L640–660 has two separate computed sections (version/model/cc_model, then the conditional standalone name spread). Consolidating all computed fields into a single clearly-labelled block would improve readability at a glance. Non-blocking.

5. **Fix `personas/ledger/README.md` server name** — References `'project-ledger'` in the "Server name is configurable" note, but the actual default in `_shared.yaml` is `'central_pm'`. Pre-existing inconsistency unrelated to this project; flagged for a future documentation pass.

6. **`data-flows.md` Layer 3 `version` comment** — Still uses `??` notation (pre-dates this project). Notation inconsistency is semantically harmless (YAML absent fields are never null), but a future docs pass could normalise all Layer 3 comments to use `!== undefined` ternary form for precision consistency.

---

## Failures & Blockers

_None._ Every pipeline across all 5 WPs passed. No regressions in the standalone suite. No security concerns. No unresolved template markers in any generated file.

---

## Next Steps

| Priority | Action | Owner | Status |
|----------|--------|-------|--------|
| Medium | Add `model` field check to `validateVSCodeFrontmatter()` | Developer | ✅ Done (2026-03-12) |
| Medium | Add `console.warn` when model fallback reaches `'inherit'` in ledger builds | Developer | ✅ Done (2026-03-12) |
| Low | Add inline comment explaining `cc_model` mid-level fallback at ~L574 in `build-personas.js` | Developer | ✅ Done (2026-03-12) |
| Low | Fix `personas/ledger/README.md` server name reference (`'project-ledger'` → `'central_pm'`) | Documentation | ✅ Done (2026-03-12) |
| Low | Consolidate computed context sections in `buildForTarget()` | Developer | ✅ Done (2026-03-12) |
