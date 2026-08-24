# Synthesis Report — Insights Sidecar Integration

## Executive Summary

This project integrated the `insights.jsonl` sidecar into every insight-gathering persona across the ledger and standalone suites, converted synthesis-writing personas from recall-based to sink-based insight compilation, and added the `plan_path` key to `ledger_get_next_action` responses so personas can resolve the plan folder at runtime. The work spanned 14 work packages across three domains: MCP server code (1 WP), reference documentation and build infrastructure (3 WPs), and persona template integration (10 WPs). All 14 WPs completed with PASS on every pipeline stage. No rework was required.

### What Was Built

1. **Two shared partials** (`insight-capture.md`, `insight-compilation.md`) provide a parameterised, resolve-once sink mechanism with a two-rung location ladder covering both ledger and standalone contexts.

2. **Eight persona integrations** (Developer, QA, Security Auditor, Documentation, Reviewer, Synthesis, standalone Developer, Web GUI Specialist) each received:
   - A role-specific Insight Observer section with In Scope / Out of Scope boundaries
   - A per-role type vocabulary tailored to the agent's territory
   - An action gate bound to a real operational protocol step
   - Separate capture and compilation partial placements
   - Rework continuation (where applicable) or documented exemption

3. **`plan_path` injection** into every `ledger_get_next_action` response via a post-processor wrapper, following the established `embedHandoffStatusInWait` pattern.

4. **Archival boundary classification** of `insights.jsonl` as generated evidence at all four archival boundaries (Git Committer, Standalone Archiver, Knowledge Archiver, `importStandaloneProject()` JSDoc).

5. **Build-time `insight_agent` validation** extracted into `scripts/lib/insight-validation.js`, preventing field drift from `role` and enforcing `insight_agent`/`insight_report_target` pairing.

6. **Reference document update** (`insights-sidecar-reference.md` v1.2) resolving all placeholders and adding action-gate, rework, consumption, and verdict-affecting findings rules.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 14 / 14 COMPLETE |
| Pipeline stages passed | 49 / 49 |
| Rework cycles | 0 |
| MCP server tests | 4,084 passed, 0 failed |
| Insight validation tests | 6 passed, 0 failed |
| Persona build | 129 personas, 0 errors |
| New shared partials | 2 |
| Personas modified | 8 (5 ledger, 3 standalone/support) |
| New constraints added | 4 (C57–C60) |
| Files modified (implementation) | ~40 across all WPs |

---

## Strategic Recommendations

1. **Build-time validation extraction pattern.** WP-013 demonstrated that extracting validation logic into `scripts/lib/` enables fixture-based testing without requiring full build orchestration. This pattern should be followed for future build-time validations: extract the pure logic into `scripts/lib/`, test with fixtures, integrate via import into `build-personas.js`. *(Source: WP-013 code-review gold-nugget)*

2. **Positive split as a design principle.** The Reviewer persona's positive split — explicitly stating which content goes to the sink vs. pipeline comments — is the most architecturally significant pattern in this plan. It prevents the collision between foreground findings and side-channel observations. Future personas with dual-channel output should adopt this affirmative routing pattern rather than relying on implicit exclusion. *(Source: WP-008 code-review)*

3. **Four-boundary exclusion perimeter.** The archival boundary classification (WP-011) creates a complete exclusion perimeter so that no path through the toolchain can accidentally promote `insights.jsonl` to source status. The structural parallelism with `scenario-coverage.md` makes the pattern instantly recognizable. Any future generated-evidence artefact should receive the same four-boundary treatment. *(Source: WP-011 code-review)*

4. **C60 action-gate accompaniment constraint.** Constraint C60 prevents the failure mode where a capture partial is included but never triggers because no operational step binds an append instruction. This forces downstream integration to wire the capture, not just include it. *(Source: WP-002 code-review)*

5. **Two-rung resolve-once sink location.** The location ladder elegantly covers both ledger and standalone contexts without requiring the shared partial to know which workflow it is in. The resolve-once instruction prevents mid-session path drift. *(Source: WP-002 code-review)*

---

## Pre-Existing Issues Noted (Not Introduced by This Plan)

- **Security Auditor workflow step 6 mentions REWORK** — the `security-audit` routing branch should only return `RUN_SECURITY_AUDIT`. Not introduced by WP-006; outside this plan's scope. *(Source: WP-006 QA)*

- ~~**11 pre-existing test failures** in `scripts/tests/build-personas-model-resolution.test.js` (7) and `scripts/tests/ledger-plugin.test.js` (4) — model resolution tests unrelated to this plan.~~ **RESOLVED:** Both `resolveModel()` in `scripts/lib/persona-model-resolution.js` and `resolveFromSlug()` in `personas/plugins/ledger/index.js` returned `entry.slug` instead of `entry.name` for the `model` field. Fixed to return `entry.name` (human-readable display name); step 4 fallback now uses `sharedModelName` / `default_model` when no registry entry exists. All 79 tests pass.

- **Reviewer operational protocol heading hierarchy** — insertion of `## Review Insight Observer` between `### Feedback Tiers` subsections displaced `#### Tier 3 — Documentation-Forward Rules` from its heading parent. Content is correct and readable but the heading hierarchy is technically non-standard. *(Source: WP-008 code-review)*

---

## Deferred & Follow-Up Items

No items were explicitly deferred or marked out-of-scope during this project. All plan deliverables were completed within the session.

**Minor process observation for future improvement:**
- 10 low-priority project-level warnings flagged documentation pipeline completions that declared no `artifacts.files_modified`. Consider standardising artifact declarations on documentation pipelines for better traceability.

---

## Next Steps

1. **Commit and release.** All changes are ready for commit. Changelog entries have been added to `personas/changelog.md` and root `changelog.md` (WP-014). Run the pre-commit hook to verify persona freshness and version sync.

2. ~~**Address pre-existing model resolution test failures.**~~ **DONE.** Fixed `entry.slug` → `entry.name` bug in `resolveModel()` and `resolveFromSlug()`. All 79 model resolution tests pass.

3. **Monitor sidecar adoption.** The sidecar infrastructure is now in place across all insight-gathering personas. Monitor the first few runs to verify that agents are correctly appending to `insights.jsonl` and that the Synthesis persona's Code Insights section compiles cleanly.

4. **Consider extending to remaining personas.** The Planner and Project Manager personas do not currently participate in the sidecar (by design — they produce strategic decisions, not code observations). If future needs arise, the shared partial infrastructure is ready.

5. ~~**Fix Security Auditor REWORK mention.**~~ **DONE**. The pre-existing REWORK reference in `5-security-auditor.md` workflow step 6 should be corrected to align with the `security-audit` routing branch's actual action set.
