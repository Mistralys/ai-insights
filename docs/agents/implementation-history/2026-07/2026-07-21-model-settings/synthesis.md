# Synthesis Report — Model Settings

**Plan:** `2026-07-21-model-settings`  
**Date:** 2026-07-21  
**Status:** COMPLETE  
**Work Packages:** 10 / 10 COMPLETE  
**Pipeline Health:** All 10 WPs passed all active pipeline stages (41 total stage passes)

---

## Executive Summary

This project replaced the hardcoded YAML-only model configuration in the ai-insights persona system with a fully GUI-managed model registry and per-persona model assignment system. A new file-based registry at `personas/model-registry/` (three files: `default.json`, `local.json`, `assignments.json`) now drives model selection across all three persona suites (ledger, standalone, ledger-support). Users can register models, assign them to individual personas, and set a global default — all from the restructured Configuration screen, which was split into three tabs (General, Persona Models, Model Registry). A "Rebuild Personas" button closes the configure-then-apply loop without requiring CLI invocation.

The implementation covered the full stack: a seed registry file (WP-001), a TypeScript model-registry module with Zod validation (WP-002), API endpoint layer with 8 REST endpoints (WP-006), GUI frontend with two fully-featured tabs (WP-007, WP-008, WP-009), orchestrator updates with a four-layer priority chain (WP-004), build system updates covering all three suites (WP-005), and multi-suite `name-mapping.json` generation with model fields (WP-003). All code was reviewed, all pipelines PASS, and comprehensive documentation was produced throughout.

---

## Metrics

### Test Suite

| Scope | Tests Passed | Tests Failed | Notes |
|---|---|---|---|
| `model-registry.ts` unit tests | 49 | 0 | 47 original + 2 rework regression tests |
| GUI integration tests (api-models) | 36 | 0 | All 15 ACs covered |
| Full GUI regression suite (final) | 3,523 | 0 | 117 test files |
| Orchestrator model resolution tests | 22 | 0 | New; covers all 5 priority chain levels |
| Full orchestrator regression suite | 1,132 | 0 | + 6 skipped |
| Persona build system tests | 107 | 0 | 17 new model-resolution tests + 90 existing |
| TypeScript compilation | 0 errors | — | `tsc --noEmit` clean throughout |

**Total unique tests across all suites at completion: ~4,800+**

### Pipeline Health

| WP | Rework Cycles | Blocking Issues Resolved |
|---|---|---|
| WP-001 | 0 | — |
| WP-002 | 1 (impl + qa + cr) | Bare `catch {}` in `writeModels()` deletion guard bypassed on corrupt `local.json` |
| WP-003 | 0 | — |
| WP-004 | 0 | — |
| WP-005 | 0 | — |
| WP-006 | 0 | Reviewer applied 1 fix-forward (PARSE_ERROR→VALIDATION_ERROR in handleGetPersonas) |
| WP-007 | 0 | Reviewer applied fix-forward (configDirty reset on re-entry) |
| WP-008 | 0 | Reviewer applied fix-forward (removed dead code in mrShowAddSlugError) |
| WP-009 | 1 (impl + qa) | Server/client contract mismatch: rebuild failure sent non-standard JSON body |

### Security Audit (WP-006)

| Severity | Count | Notes |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | Info-disclosure: `handleUpdateAssignments()` error leaks full persona ID list (localhost-only, low practical risk) |
| Info | 1 | Unconstrained cast in `handleGetPersonas()` — acceptable for read-only display |

---

## Files Changed

### New Files
- `personas/model-registry/default.json` — shipped seed registry (4 default models)
- `personas/model-registry/README.md` — field schema, lifecycle, sentinel documentation
- `mcp-server/src/gui/model-registry.ts` — model registry TypeScript module (all CRUD functions + Zod schemas)
- `mcp-server/tests/gui/model-registry.test.ts` — 49 unit tests
- `mcp-server/gui/api-models.ts` — 8 API handler functions
- `mcp-server/tests/gui/api-models.test.ts` — 36 integration tests
- `scripts/lib/persona-model-resolution.js` — ESM model resolution helper (loadModelRegistry + resolveModel)
- `scripts/tests/build-personas-model-resolution.test.js` — 17 unit tests
- `orchestrator/tests/test_persona_models_assignments.py` — 22 pytest tests

### Modified Files (key)
- `.gitignore` — excluded `local.json` and `assignments.json`
- `personas/README.md` — directory structure updated
- `personas/module-context.yaml` — new model-registry CTX document added
- `personas/plugins/ledger/index.js` — 5-step priority chain, `{{#if model}}` conditional in VS Code frontmatter
- `personas/plugins/ledger/frontmatter-templates.js` — model conditional template
- `mcp-server/gui/server.ts` — 8 new routes registered; rebuild failure fix (sendError)
- `mcp-server/gui/public/api-client.js` — 8 new API client methods
- `mcp-server/gui/public/views/config.js` — full tabbed Configuration page rewrite (3 tabs, ~1000+ lines)
- `mcp-server/gui/public/styles.css` — new CSS for config tabs and both new tab UIs
- `mcp-server/src/utils/constants.ts` — `NameMappingEntry` interface widened; AGENT_NAMES filter added
- `scripts/build-personas.js` — multi-suite name-mapping with model fields; parseYamlScalars bug fix
- `orchestrator/src/utils/persona_models.py` — four-layer priority chain with `_read_assignments()` and `_read_uuid_to_slug_map()`
- `AGENTS.md` — Model Registry row added to Cross-System Dependencies table

---

## Strategic Recommendations (Gold Nuggets)

### 1. `default.json` Seed + `local.json` Working Copy Pattern
The pattern of shipping a seed file (`default.json`) that auto-initializes a user-editable working copy (`local.json`) on first access is highly reusable. It achieves: (a) new installations get sensible defaults; (b) users can customize freely without Git tracking their choices; (c) future releases can push new defaults via "Load Defaults" without overwriting user customizations (merge-by-ID). This pattern should be the template for any future per-developer, workspace-scoped configuration files.

### 2. UUID-as-Primary-Key for Stable Assignment References
Storing model assignments using UUIDs as values (not slugs) was the right choice. It decouples identity from the display name, meaning slug renames never require a cascade update to `assignments.json`. The resolution path (UUID → slug → frontmatter value) is centralized in `getResolvedAssignments()` / `_read_uuid_to_slug_map()`, keeping consumers simple. Apply this pattern whenever user-created entities are referenced from other files.

### 3. Deterministic Zero-Namespace UUIDs for Merge-Safe Default Entries
The shipped `default.json` entries use deterministic zero-namespace UUIDs (e.g. `00000000-0000-0000-0000-000000000002`). This allows `loadDefaults()` to perform a stable merge-by-ID: new default entries can be added to `default.json` in future releases and merged into `local.json` without duplicating existing entries. Standard `crypto.randomUUID()` is appropriate only for user-created entries; reserved/well-known entries should always use deterministic IDs.

### 4. Bulk-Save Pattern vs. Instant CRUD for GUI State
The Model Registry and Persona Models tabs use a local-state-then-save pattern: edits accumulate in `mrModels`/`pmModels`, dirty indicators show what changed, and a single Save button commits everything. This eliminates partial-state errors (no failed mid-edit API call leaving the registry inconsistent) and gives users a clear discard path. Instant per-field CRUD is tempting but creates subtle race conditions and a weaker UX story. Apply the bulk-save pattern to any GUI editor that manages a list of items.

### 5. Fix-Forward Reviewer Applied Fixes Improved Cycle Time
Multiple WPs (WP-002, WP-006, WP-007, WP-008, WP-009) had minor issues (dead code, cosmetic misclassification, stale state on re-entry, CSS coupling) that were resolved directly by the Reviewer as "Fix-Forward" edits rather than bouncing back to the Developer. This pattern worked well and reduced rework cycles on non-blocking issues. The precedent is worth preserving in the review workflow.

### 6. `parseYamlScalars` Pre-existing Bug Fixed as a Side Effect (WP-003)
The build-personas.js `parseYamlScalars()` function had a latent bug: quoted scalar values followed by inline YAML comments (e.g., `key: "value"  # comment`) were not correctly unquoted because the `endsWith('"')` check failed when a trailing comment followed the closing quote. This bug was invisible for the original 7 scalar fields but surfaced immediately when `default_model` and `default_model_slug` from `_shared.yaml` were added to the parsing scope. The fix (scan for opening quote, find matching closing quote by position) is correct and was regression-tested. Opportunistic bug fixes discovered during feature work are a sign of a healthy pipeline.

---

## Technical Debt Noted

| Item | Location | Priority | Notes |
|---|---|---|---|
| Two `loadModelRegistry()` implementations (CJS plugin vs. ESM scripts lib) | `personas/plugins/ledger/index.js` vs `scripts/lib/persona-model-resolution.js` | Low | Module system boundary prevents easy unification. Behaviorally distinct (plugin is silent; scripts lib warns). Document the divergence in both files (done). |
| `server.ts handleRequest()` growing to ~1960 lines | `mcp-server/gui/server.ts` | Medium | Five new inline body-parsing route blocks (identical structure). A typed `dispatchBodyRoute()` helper would eliminate the boilerplate. Reviewer recommended a dedicated refactor WP. |
| `config.js` three-tab implementations in one file (~1000+ lines) | `mcp-server/gui/public/views/config.js` | Medium | Extracting each tab into its own file (`views/config-general.js`, etc.) would significantly improve maintainability. |
| `find_ledger_yaml_for_stage()` re-reads `workflow-manifest.json` per stage | `orchestrator/src/utils/persona_models.py` | Low | Pre-existing pattern, not introduced by this project. Will accumulate I/O as personas grow. Cached manifest read suggested. |
| `resolveModel()` rebuilds `slugToEntry` Map per call | `scripts/lib/persona-model-resolution.js` | Low | ~40 calls per build; negligible now. Return pre-built Map from `loadModelRegistry()` if ever called in tight loops. |
| `glob` pattern `[1-9]-*.yaml` in orchestrator only matches single-digit role numbers | `orchestrator/src/utils/persona_models.py` | Low | Pre-existing. Will break if ledger personas exceed 9. Pre-existing comment already flags this. |
| API client methods for model endpoints have no unit tests | `mcp-server/gui/public/api-client.js` | Low | 8 new methods verified by code inspection only. Unit tests in `api-client.test.ts` would improve regression coverage. |

---

## Deferred & Follow-Up Items

### Deferred (intentionally postponed to a future cycle)

| # | Source | Agent | Description | Priority | Rationale |
|---|---|---|---|---|---|
| D1 | WP-006 | Security Auditor | `handleUpdateAssignments()` error message leaks full persona ID list: `Valid IDs are: ${[...validPersonaIds].join(', ')}` | Medium | Low practical risk (localhost-bound, persona IDs are not secrets), but tighten to emit count or generic message. |
| D2 | WP-002 | QA | `writeModels()` calls `readModels()` internally for deletion guard — incurs an extra filesystem read on every write | Low | Minor optimization. Acceptable for current usage patterns where reads and writes happen in sequence per API request. |
| D3 | WP-003 | Reviewer | `resolveModel()` rebuilds `slugToEntry` Map on every invocation. Return pre-built map from `loadModelRegistry()`. | Low | Negligible at ~40 calls per build; defer until profiling confirms a need. |
| D4 | WP-005 | Developer | Module-level registry loaded at import time in `personas/plugins/ledger/index.js` — watch-mode builds won't pick up mid-process registry changes | Low | No watch-mode exists today; move registry load into `onBuildStart` if/when watch-mode is added. |
| D5 | WP-009 | Developer | `pmWireEvents` carries pass-through parameters that are never directly consumed by the function body | Low | Vestigial from implementation; eliminate when extracting pm* tab into its own file. |

### Out-of-Scope (beyond this plan's boundaries)

| # | Source | Agent | Description | Notes |
|---|---|---|---|---|
| OOS-1 | WP-007 | Developer | Extract each config tab into its own file (`views/config-general.js`, etc.) | Explicitly noted as out-of-scope for this WP; candidate for a dedicated refactor WP. |
| OOS-2 | WP-006 | Developer / Reviewer | Refactor `server.ts handleRequest()` with a typed `dispatchBodyRoute()` helper to reduce route boilerplate | Reviewer recommended a dedicated refactor WP. ~1960 lines now. |
| OOS-3 | WP-009 | Reviewer | Replace `window.confirm()` dirty-guard with custom modal if a modal system is introduced in future WPs | Only relevant if a modal abstraction is ever added to the SPA. |
| OOS-4 | WP-008 | QA | Add jsdom/client-rendering unit tests for frontend helpers (`mrDeriveSlug`, `mrValidateSlug`, `mrHasChanges`) | Frontend helper test infrastructure doesn't exist yet; establishing it is a separate effort. |
| OOS-5 | WP-006 | QA | Add unit tests for 8 new API client methods in `api-client.test.ts` | Low priority; AC-14 met by code inspection. Add in a future QA hardening cycle. |
| OOS-6 | WP-008 | Reviewer | Client-side duplicate-slug detection before Save (currently surfaces only on server round-trip) | Server is authoritative; client-side pre-check is a UX improvement, not a correctness fix. |
| OOS-7 | WP-008 | Reviewer | Client-side empty-name guard in inline edit Done path (empty name currently surfaces as server 400) | Same as above — UX improvement. |
| OOS-8 | WP-004 | Reviewer | `find_ledger_yaml_for_stage()` re-reads manifest N times per `extract_persona_model_slugs()` invocation | Pre-existing pattern. Candidate for orchestrator I/O optimization cycle. |

---

## Next Steps for the Planner / Project Manager

1. **Deliver the user story**: All features are implemented and documented. The next action for a user is to start the GUI, open the Configuration → Model Registry tab, register or adjust models, assign them via the Persona Models tab, and click Rebuild Personas. No further code changes are needed for the core feature.

2. **Plan a GUI refactor WP** targeting `server.ts handleRequest()` (D2 / OOS-2) and `config.js` tab extraction (OOS-1). These are the two highest-medium-priority technical debt items. Bundling them in a single "SPA maintainability" WP is efficient.

3. **Address info-disclosure in `handleUpdateAssignments()`** (D1 / Security finding). A one-line change in `api-models.ts` replaces the persona-ID list in the error message with a count or a generic message. Low-effort, medium priority.

4. **Consider client-side UX hardening** (OOS-4, OOS-6, OOS-7): add jsdom tests for frontend helpers, add duplicate-slug pre-check, add empty-name guard on Done. These are UX quality-of-life improvements that can be grouped into a "config tab UX polish" WP.

5. **Revisit orchestrator I/O pattern** (OOS-8 / D8) when the persona count grows. Not urgent until the system exceeds ~50 personas.

6. **Track the `[1-9]-*.yaml` glob limitation** in the orchestrator. Low urgency but will silently break if ledger roles ever exceed 9. A simple change to `[0-9]{1,2}-*.yaml` would future-proof it.
