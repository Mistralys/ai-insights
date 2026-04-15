# Synthesis Report — PM Subagent Reliability

**Plan:** `2026-04-14-pm-subagent-reliability`
**Date:** 2026-04-15
**Status:** COMPLETE — 11/11 work packages delivered

---

## Executive Summary

This plan eliminated four root causes that prevented the PM stage of orchestrator runs from reliably
invoking its four sub-agents. The core fix replaced a static, manually-maintained `STAGE_SUBAGENT_FILES`
dict in `config.py` with a fully metadata-driven architecture: each ledger persona YAML now declares
its own `subagents` list, and the orchestrator resolves sub-agent specs at startup by reading that
metadata. A companion post-build validation in `build-personas.js` ensures that `{{agent_slug_*}}`
template variables in persona content always match the declared subagent slugs.

The following changes were delivered across three codebases:

| Codebase | Change | Version |
|---|---|---|
| `ai-insights` · `orchestrator/` | `load_subagents()` rewritten — metadata-driven, `STAGE_SUBAGENT_FILES` removed | v0.17.0 |
| `ai-insights` · `personas/` | `subagents` field added to PM YAML; `subagent_type` fix in template; `{{agent_slug_*}}` cross-reference validation in `build-personas.js`; 84 personas rebuilt | v3.16.0 |
| `ai-persona-builder-STABLE` | `subagents?: string[]` added to `PersonaMetadata`; `validateSubagentRefs()` implemented; new `agentMap` parameter on `buildPersona()` | v2.4.0 |

---

## Metrics

| Metric | Result |
|---|---|
| Work packages delivered | 11 / 11 |
| Pipeline stages passed | 36 / 36 (11 × implementation + qa + code-review; 8 × documentation; 1 × release-engineering) |
| MCP server test suite | **1826 / 1826 PASS** |
| Orchestrator test suite | **961 / 961 PASS** (19 new + 942 pre-existing) |
| Persona builder test suite | **333 / 333 PASS** (7 new + 326 pre-existing) |
| Persona build output | **84 / 84 files generated** (9 ledger + 19 standalone × 3 targets) |
| Regressions | **0** |
| Rework cycles | **0** |
| Plan duration | ~1.5 hours |

---

## What Was Built

### 1 — Metadata-Driven Sub-Agent Configuration (WP-001, WP-002, WP-005)

**Before:** `STAGE_SUBAGENT_FILES` in `config.py` listed only 1 of 4 sub-agents, using a display-name
(`"Ledger WP Decomposer"`) that did not match the kebab-case slug the PM persona specified.

**After:** `load_subagents("pm", workspace_root)` reads the PM's YAML `subagents` list, resolves
descriptions from `personas/standalone/src/meta/{slug}.yaml`, and loads `system_prompt` from
`personas/standalone/deep-agents/{slug}.md`. The `name` field is now the kebab-case slug itself —
exactly what Deep Agents' `task` tool requires for `subagent_graphs` lookup.

New utility helpers added to `orchestrator/src/utils/persona_models.py`:
- `_extract_yaml_list(text, key) -> list[str]` — stdlib-only YAML list parser, 10 edge-case tests
- `find_ledger_yaml_for_stage(stage_id, workspace_root) -> (Path, str) | None` — stage-to-file lookup, 6 tests

`STAGE_SUBAGENT_FILES` fully removed from `orchestrator/src/config.py`.

### 2 — Parameter Name Fix: `subagent` → `subagent_type` (WP-003)

**Before:** All four `target_deep_agents` dispatch blocks in the PM persona template used `subagent:`,
which Deep Agents' `SubAgentMiddleware` silently ignores (expected parameter is `subagent_type`).

**After:** All four blocks corrected to `subagent_type: {{agent_slug_*}}`. The fix was surgical:
exactly 4 lines changed, all `{{agent_slug_*}}` variables intact.

### 3 — Build-Time Slug Validation in `persona-builder` (WP-004, WP-006)

`validateSubagentRefs()` added to `ai-persona-builder-STABLE/src/builders/persona-builder.ts`:
- Called at step 9 of `buildPersona()` alongside `runValidate()`
- Returns `error`-severity `ValidationResult` per unknown slug
- Strict mode throws on first invalid slug
- Personas with no `subagents` field pass with zero overhead
- New 9th `agentMap` parameter with default `{}` is fully backward-compatible

`PersonaMetadata.subagents?: string[]` added as an explicit typed field in `src/plugins/types.ts`.

### 4 — Cross-Reference Validation in `build-personas.js` (WP-007, WP-008)

A new unconditional post-build block in `scripts/build-personas.js` scans every ledger persona content
file for `{{agent_slug_X_Y}}` references, converts the suffix to kebab-case, and verifies the slug
appears in the persona's `subagents` YAML field. Exits 1 with a precise error on mismatch:

```
Persona "2-project-manager": {{agent_slug_nonexistent_bad_agent}} references slug
"nonexistent-bad-agent" which is not declared in the subagents list. Add
"nonexistent-bad-agent" to the subagents field in 2-project-manager.yaml.
```

Runs on both real builds and `--check` mode, blocking CI on drift before it reaches a runtime failure.

### 5 — Documentation & Manifests (WP-006, WP-009, WP-010)

All three project manifests updated to reflect the new architecture:
- `personas/docs/agents/project-manifest/api-surface.md` — `subagents` field; `validateSubagentRefs()`; `extractSubagentsList()`
- `orchestrator/docs/agents/project-manifest/api-surface.md` — `load_subagents()`, `_extract_yaml_list()`, `find_ledger_yaml_for_stage()`
- `orchestrator/docs/agents/project-manifest/constraints.md` — Constraint 18 (metadata-driven subagents), Constraint 20 (`subagent_type` convention)
- `AGENTS.md` + `CLAUDE.md` — Cross-System Dependencies table updated
- `orchestrator/docs/architecture.md` — PM subagents table now lists all 4 slugs
- `.context/` — Regenerated to sync all snapshots

### 6 — Changelog & Version Bumps (WP-011)

| Module | Version | Key notes |
|---|---|---|
| `orchestrator` | 0.16.0 → **0.17.0** | `load_subagents()` rewrite, utils helpers, test rewrite |
| `personas` | 3.15.x → **3.16.0** | subagents YAML, `subagent_type` fix, cross-ref validator, rebuild |
| `ai-persona-builder` | 2.3.0 → **2.4.0** | `subagents` field, `validateSubagentRefs()`, `agentMap` param |

> **Pending:** Root `changelog.md` entry targeting these three module versions has not yet been written
> (Release Engineer correctly deferred this — it is typically done at Git tag time).

---

## Strategic Recommendations (Gold Nuggets)

### 1 — Static Configuration Drifts; Metadata Doesn't

`STAGE_SUBAGENT_FILES` was a static dict that had to be manually kept in sync with persona template
files. The very first time a slug was added to a template without updating `config.py`, the orchestrator
silently ran the stage without sub-agents. The metadata-driven architecture makes this impossible:
the single declaration in `2-project-manager.yaml` is the authoritative source for both the
orchestrator loader and the build-time validator.

**Principle:** Whenever a config key duplicates a value that already lives in a source-of-truth file
(persona YAML, manifest, etc.), replace the config key with a derived reader.

### 2 — Silent Parameter Failure Is a Design Smell in Deep Agents Integration

Deep Agents silently ignores an unrecognized `subagent:` parameter and routes the PM stage as a
bare agent call. There is no warning, no error, no observable difference in log structure — the stage
just does all the work inline instead of delegating. This class of failure (wrong parameter name, no
error) is particularly dangerous because it is not caught by tests that only assert on outputs, only
on behavior.

**Recommendation:** Add an integration smoke test to the orchestrator that confirms a pm-stage run
actually dispatches `task` tool calls (observable via the JSONL log `tool_name` field), not just
produces a plan result inline.

### 3 — `node_modules` Staleness Causing Silent Feature Loss (WP-008)

The `personas/` package had `package-lock.json` referencing `@mistralys/persona-builder@2.4.0`, but
`node_modules` was still at 2.3.0. v2.4.0 introduced `deep-agents` target support — without it, the
build silently skipped generating `personas/ledger/deep-agents/` and `personas/standalone/deep-agents/`
with no error. The fix was `npm install`, not a code change.

**Recommendation:** Add a pre-build version check in `build-personas.js` that reads the installed
package version from `node_modules/@mistralys/persona-builder/package.json` and warns (or errors) if
it does not match the lock file pinned version.

### 4 — Two Independent YAML List Parsers

`_extract_yaml_list()` (Python, `orchestrator/src/utils/persona_models.py`) and `extractSubagentsList()`
(JavaScript, `scripts/build-personas.js`) implement the same flat dash-prefixed YAML block list parsing
logic independently. Both handle inline comments, quoted values, and list termination at the next
top-level key. Edge cases where one implementation may diverge from the other will be invisible until a
real YAML value triggers the difference.

**Recommendation:** Consider extracting a shared `scripts/lib/yaml-utils.js` module (consumed by
`build-personas.js`) that can be documented and tested in isolation. This consolidates the
maintenance surface without requiring a full YAML parser dependency.

### 5 — `validateSubagentRefs()` Runs Per-Target, Not Per-Persona

`validateSubagentRefs()` is called once per `buildPersona()` invocation, which is once per
persona × target (3 targets → 3 identical validation passes per persona). The `agentMap` and
`subagents` inputs don't change between targets for the same persona. With 9 ledger personas × 3
targets = 27 calls today, this is inconsequential — but as the target count grows, this becomes
a linear multiplier on a fixed-cost operation.

**Recommendation (low priority):** Hoist `validateSubagentRefs()` into `buildSuite()` to run once
per persona rather than per build target.

---

## Next Steps

1. **Root changelog entry** — Write the root `changelog.md` entry referencing `orchestrator v0.17.0 · personas v3.16.0 · ai-persona-builder v2.4.0` before the next Git tag.

2. **PM sub-agent dispatch integration test** — Add an orchestrator test (or log-based assertion) that confirms a PM stage actually emits `task` tool calls to sub-agents rather than doing all work inline. This would have caught the original `STAGE_SUBAGENT_FILES` bug and the `subagent` parameter name bug before they reached production.

3. **`node_modules` version guard** — Add a pre-build check to `build-personas.js` that compares the installed `@mistralys/persona-builder` version against the lock file to prevent silent feature loss on stale installs.

4. **`extractSubagentsList` consolidation (optional)** — If `scripts/build-personas.js` acquires more YAML parsing needs, create `scripts/lib/yaml-utils.js` to consolidate JS and Python implementations.

5. **WP-008 spec file correction** — The `work/WP-008.md` spec file still lists `WP-005` as a dependency (incorrect) instead of `WP-003, WP-004, WP-007`. A low-risk historical correction.
