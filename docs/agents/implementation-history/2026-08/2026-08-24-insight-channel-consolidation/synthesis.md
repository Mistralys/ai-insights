# Project Status Report — Insight Channel Consolidation

**Date:** 2026-08-24
**Plan:** `2026-08-24-insight-channel-consolidation`
**Status:** COMPLETE — all 14 work packages passed all pipeline stages.

---

## Executive Summary

Eliminated the `insights.jsonl` sidecar from the ledger workflow and consolidated all code-level observations into the existing MCP observation tools (`ledger_add_observation` and `ledger_complete_pipeline` comments). The sidecar's `loc` field — its only structural advantage — was added to the MCP schema, closing the expressiveness gap. The two observation systems now have zero overlap: ledger agents use MCP tools exclusively, standalone agents use the JSONL sidecar exclusively.

The project touched 3 MCP server source files, 10 persona template/content files, 7 persona YAML metadata files, 4 manifest documentation files, and 1 reference document. A new shared partial (`mcp-insight-capture.md`) parameterized by `insight_pipeline_type` replaced per-persona duplication of the capture discipline block. All 5 ledger persona operational protocols were retargeted from sidecar to MCP-based observation capture. The persona build produces 129 personas with 0 errors and 0 warnings.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 14 / 14 COMPLETE |
| Pipeline stages passed | 48 / 48 (all PASS) |
| MCP server tests | 4,081 / 4,081 pass |
| Persona build | 129 / 129 personas, 0 errors, 0 warnings |
| Build freshness (`--check`) | Clean — output matches source |
| Rework cycles | 0 across all WPs |
| Fix-forwards applied | 2 (by Reviewer) |
| Unplanned fixes | 1 (stray sidecar ref in `synthesis-output-format.md`) |

### Test Details

- **WP-001 QA:** 3,976 / 4,022 pass (46 failures are pre-existing GUI server test issues — `server.close` undefined, not introduced by this plan)
- **WP-003 QA:** 4,081 / 4,081 pass (after loc field tests added)
- **WP-014 QA:** 4,081 / 4,081 pass (full regression, zero failures)

---

## Strategic Recommendations

### Parameterized-Partial Pattern (Gold Nugget)

The `mcp-insight-capture.md` partial parameterized by `{{insight_pipeline_type}}` is a clean architecture upgrade. It consolidates the capture discipline from 5 separate per-persona blocks into a single ~15-line template (vs ~40 lines for the sidecar version) and reduces per-persona YAML from 2 fields (`insight_agent` + `insight_report_target`) to 1 (`insight_pipeline_type`). **This parameterized-partial pattern is worth reusing for any future per-pipeline persona customization.** (Flagged by Reviewer as gold-nugget, corroborated by QA via build warning elimination.)

### Optional-Field Truthiness Spread Pattern

The `loc` field pass-through in `addObservation()` uses `args.loc ? { loc: args.loc } : {}` — consistent with the existing `context` field pattern in `PipelineCommentSchema`. This pattern keeps the schema clean (no `null` or empty-string values persisted) while maintaining full backward compatibility. Note: empty-string `loc` values are silently dropped by the truthiness guard, which is harmless since empty loc has no semantic value. (Flagged by QA as edge-case.)

---

## Code Insights

### Developer (2 substantive entries across 4 sessions)

- **improvement** (`personas/ledger/src/content/9-synthesis.md`): Identified that the Synthesis content file still included `{{> insight-compilation}}` even though Synthesis is consumer-only — clean removal.
- **convention** (`personas/shared/partials/mcp-insight-capture.md`): Build-time `insight-validation.js` validates the `insight_agent`/`insight_report_target` pair but has no awareness of `insight_pipeline_type`. Safe because the removed fields are optional, but a new validation rule would be needed if `insight_pipeline_type` is ever made mandatory for ledger personas.

### QA (8 substantive entries across 4 sessions)

- **coverage-gap** (`mcp-server/tests/tools/observations.test.ts`): Initially no test exercised the `loc` field end-to-end. Addressed by WP-003 which added store-backed positive and negative loc tests.
- **edge-case** (`mcp-server/src/tools/observations.ts:69`): Truthiness guard on `args.loc` silently drops empty-string values. Harmless — `z.string().optional()` accepts `undefined` as the natural absent signal.
- **coverage-gap** (`personas/ledger/src/meta/9-synthesis.yaml`): Stale `inputs`/`outputs` overview fields referencing `insights.jsonl`. Resolved by Documentation in WP-014. (Also flagged by Reviewer.)
- 5× **improvement** entries confirming clean retargeting across all 5 operational protocols — step renumbering correct, no residual sidecar references, build warnings dropped to 0.

### Reviewer (5 substantive entries across 3 sessions)

- **convention** (`mcp-server/src/tools/pipeline.ts`): `CompletePipelineSchema` loc description said "File path or module" while `AddObservationSchema` said "File path, module, or component" — aligned to the more complete wording. Fix-forward applied.
- **convention** (`mcp-server/tests/tools/observations.test.ts`): Unused imports `mkdir` and `writeFile` from `fs/promises` — removed. Fix-forward applied.
- **gold-nugget** (`personas/shared/partials/mcp-insight-capture.md`): Parameterized-partial approach is a clean upgrade — worth reusing for future per-pipeline persona customization. (See Strategic Recommendations.)
- **convention** (`personas/ledger/src/meta/9-synthesis.yaml`): Stale overview metadata — documentation-forwarded and resolved.
- 4× **improvement** entries confirming clean retargeting across operational protocols and YAML metadata.

### Documentation (7 substantive entries across 3 sessions)

- **improvement** (`mcp-server/docs/agents/project-manifest/api-surface.md`): Added `loc` field to `ledger_add_observation` and `ledger_complete_pipeline` comments signatures.
- **improvement** (`mcp-server/docs/agents/workflow-specification/data-model.md`): Added `loc` field to `PipelineComment` data model.
- **improvement** (`personas/docs/agents/project-manifest/api-surface.md`): Updated ledger metadata table (replaced `insight_agent`/`insight_report_target` with `insight_pipeline_type`), updated shared partials table, narrowed standalone-only partials.
- **doc-stale** (`AGENTS.md`): `CLAUDE.md` is auto-generated from `AGENTS.md` but was not regenerated — will be resolved on next CTX generation pass. (Medium priority — see Deferred Items.)
- **improvement** (`docs/references/insights-sidecar-reference.md`): Scoped to standalone-only — integration table narrowed from 8 rows to 2.
- **improvement** (`personas/ledger/src/meta/9-synthesis.yaml`): Fixed stale `inputs`/`outputs` overview metadata. Regenerated `agents-overview.md`.

---

## Deferred & Follow-Up Items

| # | Source | Agent | Description | Classification | Priority |
|---|--------|-------|-------------|----------------|----------|
| 1 | WP-004 | Documentation | `CLAUDE.md` is stale after `AGENTS.md` update (insight_agent/role coupling entry narrowed to standalone). Will self-resolve on the next `ctx-generate` pass. | **Deferred** | Medium |
| 2 | WP-004 | Developer | `insight-validation.js` has no awareness of `insight_pipeline_type`. Safe today (removed fields are optional), but if `insight_pipeline_type` is ever made mandatory for ledger personas, a new validation rule will be needed. | **Out-of-scope** | Low |
| 3 | WP-001 | QA | 46 pre-existing GUI server test failures (`server.close` undefined). Not introduced by this plan — pre-existing issue. | **Out-of-scope** | Low |

---

## Next Steps

1. **Run `ctx-generate`** to regenerate `.context/` docs and `CLAUDE.md` — resolves deferred item #1.
2. **Consider `insight_pipeline_type` validation** if the field is ever promoted to mandatory for ledger personas (deferred item #2).
3. **Prepare changelog entries** — this plan touches the MCP server (`loc` field on schemas) and personas (channel consolidation, new partial, YAML metadata), so both module changelogs need entries.
4. **Monitor standalone sidecar health** — the sidecar is now standalone-exclusive. If any standalone persona workflow changes are planned, verify the sidecar integration table in `insights-sidecar-reference.md` stays current.
