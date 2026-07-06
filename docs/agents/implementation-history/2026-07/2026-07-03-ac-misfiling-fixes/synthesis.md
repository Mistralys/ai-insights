# Synthesis Report — AC Misfiling Fixes

**Plan:** `2026-07-03-ac-misfiling-fixes`
**Status:** COMPLETE
**Date:** 2026-07-03
**Work Packages:** 5 / 5 COMPLETE

---

## Executive Summary

This project addressed a systemic acceptance-criteria (AC) misfiling problem diagnosed across multiple prior ledger workflow executions and documented in two independent research reports. Five root-cause issues (I1–I5) were identified spanning three layers of the AC lifecycle — materialization, verification, and planning. All five issues were resolved through **persona-source-only changes** to six Markdown/YAML files, with no MCP server code modifications required. The build pipeline (`node scripts/build-personas.js`) produced clean output throughout (120 personas, 0 errors) across all three deployment targets (claude-code, deep-agents, vs-code).

The core achievement is a defense-in-depth AC lifecycle: criteria are now authored with stable numbered identifiers, materialized from a single source, verified at two checkpoints, and correctly copied at runtime by Developer and QA agents.

---

## Work Package Summary

| WP | Title | Scope | All Stages | Result |
|----|-------|-------|-----------|--------|
| WP-001 | Numbered Plan AC + Decomposer Coverage Table | Planner template (AC-{NN} format), WP Decomposer coverage table + quality checklist | impl → qa → review → docs | ✅ PASS |
| WP-002 | Verbatim AC Text Guidance for Developer and QA | `developer-strict-constraints.md`, `qa-operational-protocol.md` | impl → qa → review → docs | ✅ PASS |
| WP-003 | Bootstrapper Register-Before-Create Reorder | `ledger-bootstrapper.md` — swap Steps 3↔4, remove ID mismatch handling, add single-source AC rule | impl → qa → review → docs | ✅ PASS |
| WP-004 | AC Content-Level Verification Gate | Bootstrapper Step 6 (warn), PM Step 9 (self-heal), `pm-output-format.md` partial | impl → qa → review → docs | ✅ PASS |
| WP-005 | Integration Build & Diff Verification | Final clean build + diff scoping across all WP changes | impl → qa → review → docs | ✅ PASS |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages completed | 5 / 5 |
| Pipeline stages completed | 20 / 20 (all 4 stages × 5 WPs) |
| Pipeline failures | 0 |
| Build passes (node scripts/build-personas.js) | 5 × 0 errors (120 personas each) |
| QA tests passed | 4 (WP-001) + 4 (WP-002) + 4 (WP-003) + 4 (WP-004) + 3 (WP-005) = **19 verified ACs** |
| QA tests failed | 0 |
| Source files modified | 13 persona source files |
| Build output files regenerated | 120 personas × 3 targets (claude-code, deep-agents, vs-code) |
| Changelog entries added | 8 (personas/changelog.md, v3.26.0 WIP) |
| Context documents regenerated | 34–35 `.context/` documents |
| Reviewer fix-forward edits applied | 3 (spec template placeholder, Step 5 heading, case-fold terminology alignment) |

---

## What Was Built

### Layer 1 — Materialization (WP-003)

**Issue I1 (Bootstrapper step reorder):** The Bootstrapper now registers WPs in the ledger (Step 3) *before* creating spec files on disk (Step 4). Spec files are named using the ledger-returned WP ID, eliminating the rename step and the three-way numbering juggle that caused filename/ledger ID mismatches.

**Issue I3 (Single-source AC rule):** The Bootstrapper now explicitly prohibits re-transcribing AC from the WP draft when writing the spec file's `## Acceptance Criteria` section. The section must be copied from the same `acceptance_criteria` array passed to `ledger_create_work_package` in Step 3 — ensuring the spec file and ledger entry are identical by construction.

**Additional fix-forwards applied during review:**
- Spec file template placeholder updated from `{Verbatim from WP draft}` to `{← copied from acceptance_criteria array passed to ledger_create_work_package in Step 3}` — eliminating contradiction with the Single-source AC rule.
- Step 5 heading renamed to `Add Status Column to Work Summary Index` (from the misleading `After all WPs are registered`).
- A 7-step procedure summary line added to the Bootstrapping Protocol header for quick orientation.

### Layer 2 — Verification (WP-004)

**Issue I2 (AC content-level verification gate):** A defense-in-depth verification layer was added at two checkpoints:

- **Bootstrapper Step 6 (warn-only):** Calls `ledger_get_work_package` for each WP and compares the returned `acceptance_criteria` against the spec file's `## Acceptance Criteria` section using normalized comparison (trim + case-folding). Emits a warning on mismatch without aborting. Count mismatches are explicitly flagged (surplus or missing items treated as mismatches — not silently skipped). Step 7 report template now includes an AC Check column (✅ Match / ⚠️ Mismatch).

- **PM Step 9 (self-healing):** The Project Manager now calls `ledger_get_work_package` for each WP and, if a mismatch is detected, updates the spec file to match the ledger (ledger is authoritative) before handoff. The `pm-output-format.md` partial was updated to include this AC content fidelity instruction. `ledger_get_work_package` was added to the PM's MCP tools YAML.

**Architecture verdict (from code review):** The warn-only (Bootstrapper) vs. self-heal (PM) division of responsibility is well-considered. The Bootstrapper is stateless and reports only; the PM owns the gate and corrects before handoff. This prevents silent drift without adding complexity in the wrong layer.

### Layer 3 — Planning + Runtime Guidance (WP-001, WP-002)

**Issue I4 (Numbered plan AC):** The Planner's Plan Output Template now emits acceptance criteria with `AC-{NN}:` prefixes (zero-padded sequential IDs), with an explanatory instruction embedded in the template. The WP Decomposer gains:
- A new **Step 3 — Map Plan AC to WPs** (old Step 3 renumbered to Step 4)
- A **`## Plan AC Coverage` table** in the output template mapping each `AC-{NN}` to covering WP(s) and WP AC references
- A quality checklist item: "Every plan `AC-{NN}` appears in the Plan AC Coverage table with at least one covering WP"
- The Output Template was split into two fenced code blocks with a prose separator note between the WP definitions and the coverage table (Documentation pipeline fix-forward)

**Issue I5 (Verbatim AC text guidance):** Developer and QA personas gain explicit verbatim-copy guidance: when populating `acceptance_criteria_updates` in `ledger_complete_pipeline`, they must copy criterion text verbatim from `ledger_get_work_package` output (exact-match `===` behavior is intentional and unchanged — the guidance addresses the agent behavior, not the tool). The guidance explains exact-match comparison behavior and warns about silent phantom duplicate criterion creation.

### Integration (WP-005)

A final clean build-and-diff pass confirmed:
- `node scripts/build-personas.js` exits 0, 120 personas processed
- `node scripts/build-personas.js --check` exits 0 (fresh output)
- `git diff --name-only` shows exactly 13 source files — all mapping 1-to-1 to WP-001 through WP-004, no unintended modifications
- `personas/changelog.md` updated with 8 v3.26.0 entries covering all fixes

---

## Strategic Recommendations

### Gold Nuggets

1. **Defense-in-depth for AC fidelity is the right architecture.** The three-layer approach (construct correctly → warn early → self-heal at the gate) is resilient. The Bootstrapper warning provides early detection with no blast radius; the PM self-heal provides a hard guarantee before handoff. Future persona workflows should adopt this pattern for other critical data fields.

2. **Single-source-of-truth rules should be explicit and co-located with the template.** The `{Verbatim from WP draft}` placeholder directly contradicted the Single-source AC rule on the same page — spotted and fixed by the code reviewer. Template placeholders and their governing rules must be co-located and consistent.

3. **Verbatim-copy guidance solves exact-match tool constraints without server-side normalization.** The exact-match `===` behavior in `pipeline.ts` is intentional (per `edge-cases.md` §21.3). Rather than changing tool behavior, persona guidance achieves the same correctness outcome at lower risk. This is the preferred pattern for behavioral gaps that stem from intentional tool design.

4. **The Reviewer's fix-forward pattern works well for low-priority cosmetic issues.** Three non-behavioral fixes were applied directly by the Reviewer (terminology alignment, placeholder wording, heading accuracy) rather than creating new WPs. This avoids WP proliferation for sub-line changes while still closing the loop.

5. **The build script's `PERSONA_FILES` list is a known maintenance coupling** (`scripts/build-personas.js` line ~89–98): it must stay in sync with the 9 ledger roles in `shared/workflow-manifest.json`. A self-documenting comment is in place, but this is a future brittleness point if new roles are added.

6. **No automated content-linting exists for persona Markdown structure.** The build script validates file counts and targets but not structural constraints (e.g., AC-{NN} format present, step numbering sequential). A linting step would provide regression protection for future WPs — this gap was flagged independently by QA agents in WP-001 and WP-005.

---

## Deferred & Follow-Up Items

| Source | Agent | Description | Type | Priority |
|--------|-------|-------------|------|----------|
| WP-001 | Developer | The AC numbering instruction in `1-planner.md` is embedded inside the fenced code block as a plain-text paragraph, while other template annotations (e.g., `{Optional — omit…}`) appear outside the fence. Functionally unambiguous but mildly inconsistent with surrounding style. | deferred | low |
| WP-002 | Reviewer | `developer-strict-constraints.md` and `qa-operational-protocol.md` now have the Verbatim AC Text guidance. Other agents that also call `ledger_complete_pipeline` with `acceptance_criteria_updates` (e.g., Documentation, Reviewer) do not yet have this guidance in their respective persona partials. | deferred | medium |
| WP-003 | QA | The spec file template in Step 4 placeholder now references the Step 3 array (fixed in code review), but the overall template style for the Bootstrapper could be reviewed holistically in a future pass. | deferred | low |
| WP-004 | QA | Bootstrapper Step 6 uses "lowercasing" while PM Step 9 and `pm-output-format.md` use "case-fold" — aligned to "case-folding" in code review, but a future audit of all three files should confirm full consistency. | resolved in review | low |
| WP-005 | Developer | `personas/README.md` contains a stale persona count ("48 AI agent persona files") — the build system now produces 120 personas across 3 suites. Pre-existing documentation debt from before v3.25.0. | deferred | low |
| WP-005 | QA | No automated content-linting for persona Markdown structure (AC-{NN} format, step numbering). The build script validates file counts but not structural constraints. | out-of-scope | medium |
| WP-001 | QA | No automated test suite for persona content validation — the build script confirms file counts and output targets but does not assert structural constraints. A content-linting step could catch regressions automatically in future. | out-of-scope | medium |
| WP-003 | Reviewer | Bootstrapper Step 6 does not explicitly require checking that the *count* of criteria matches before comparing in order — fixed in Documentation pipeline (count mismatch now explicitly flagged). | resolved | low |

---

## Next Steps

The following items are recommended for the next planning cycle, in rough priority order:

1. **[HIGH] Extend Verbatim AC Text guidance to Documentation and Reviewer personas.** WP-002's fix covers Developer and QA, but `docs-operational-protocol.md` and `reviewer-operational-protocol.md` do not yet include the verbatim-copy guidance. These agents also call `ledger_complete_pipeline` with `acceptance_criteria_updates`.

2. **[MEDIUM] Add persona content-linting to the build script.** A linting pass that asserts structural constraints (e.g., `AC-{NN}:` format present in plan templates, sequential step numbering, no orphaned template placeholders) would protect against regressions across future persona edits. This was flagged independently by multiple QA agents across this project.

3. **[MEDIUM] Evaluate promoting the Bootstrapper AC mismatch warning to a hard failure.** The plan explicitly designed the warning as a "start with warn, measure false-positive rate, promote to hard failure once confidence is high" approach. After field-testing the new pipeline, this should be revisited.

4. **[LOW] Fix the stale persona count in `personas/README.md`.** The count "48 AI agent persona files" is pre-existing debt; the build now produces 120 personas across 3 suites.

5. **[LOW] Standardize template annotation style in `1-planner.md`.** The AC numbering instruction is embedded inside the fenced code block; other template annotations use a `{Optional — omit…}` convention outside fences. Low-priority style consistency pass.

6. **[LOW] Review `scripts/build-personas.js` `PERSONA_FILES` list coupling.** The list must stay in sync with `shared/workflow-manifest.json` manually. Adding a schema validation step or generating the list from the manifest would remove this maintenance risk.

---

## Files Modified (Canonical List)

**Source files:**
- `personas/ledger/src/content/1-planner.md`
- `personas/ledger/src/meta/1-planner.yaml` (v1.8.0)
- `personas/ledger/src/content/2-project-manager.md`
- `personas/ledger/src/meta/2-project-manager.yaml`
- `personas/ledger/src/meta/3-developer.yaml` (v3.6.5)
- `personas/ledger/src/meta/4-qa.yaml` (v3.6.3)
- `personas/ledger-support/src/content/ledger-bootstrapper.md`
- `personas/ledger-support/src/content/ledger-wp-decomposer.md`
- `personas/ledger-support/src/meta/ledger-wp-decomposer.yaml` (v1.1.0)
- `personas/shared/partials/developer-strict-constraints.md`
- `personas/shared/partials/qa-operational-protocol.md`
- `personas/shared/partials/pm-output-format.md`
- `personas/changelog.md` (v3.26.0 WIP — 8 entries added)

**Build outputs regenerated:** All 3 targets (claude-code, deep-agents, vs-code) for all modified personas; `personas/name-mapping.json`; 34+ `.context/` documents.
