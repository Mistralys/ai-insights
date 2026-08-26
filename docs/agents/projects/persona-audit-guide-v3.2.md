# Persona Audit — Design Guide v3.2

**Created:** 2026-08-26
**Guide Version:** 3.2
**Mode:** Audit

## Audit Focus

Recent guide updates that personas should be checked against:

| Guide Version | Key Changes |
|---|---|
| v3.2 | Added "Metadata Without a Build System" — separates build-input metadata from governance metadata, and makes both optional for personas authored directly as system prompts (Gemini Gems, Claude Projects, custom GPTs); the Governance Metadata section no longer presupposes a metadata file or a build step. |
| v3.1 | Added "Recurring Principles Across a Persona Suite" — name forking vs. name collision, the general-claim-over-symptom rule, and when a shared bullet warrants a partial (whole sections only); the vocabulary itself stays project-local. Clarified that the mood rule applies to every sentence of a principle body, not just its opener. |
| v3.0 | Separated polarity from mood in Operating Philosophy — positive framing no longer implies imperative phrasing; replaced the v2.3 "Prefer X over Y" templates with indicative ones; added the "You should" test with a rewrite table; added the verb-initial title rule; added two checklist items and the "Positively framed commands in philosophy" pitfall. |
| v2.9 | Added Governance Metadata section documenting `audit_guide_version`, `audit_date` and the new `design_notes` field; documented deviations are now accepted exceptions rather than repeat audit findings; added related checklist item. |
| v2.8 | Added design rule for self-contained sub-sections: reusable partials and dedicated procedure blocks consolidate their constraints into their own Constraints heading rather than scattering them inline. |
| v2.7 | Added Core Philosophy principle 7 (Tone Stratification); reserved imperative voice for Rules & Constraints only; rewrote checklist tone item to enforce stratification; added "All-imperative monotone" pitfall; fixed Mission template wording. |
| v2.6 | Added Pattern 15 rules for observable-action gating, own-step placement, and skipped-duty visibility; expanded Pattern 6 with session-start sink opening and liveness markers; added related checklist items and two pitfalls. |
| v2.5 | Added Pattern 15 (Trigger Anchoring — duty and constraint salience classes); expanded Pattern 6 with forcing functions and incremental capture; added Core Philosophy principle 6 (Salience Beats Volume); added related checklist items and pitfalls. |
| v2.4 | Added Pattern 14 (Task Separation); added workflow design rule, quality checklist item, and common pitfall for phase homogeneity. |
| v2.3 | Added positive-framing rule and litmus test to Operating Philosophy; added "Philosophy reads like constraints" pitfall; added checklist item for philosophy tone. |
| v2.2 | Added Markdown separator handling; added License, Author and Source metadata to the header. |
| v2.1 | Added "Lead with a verb, not You" guidance to the Mission section; documented second-person voice as an anti-pattern. |
| v2.0 | Major revision — expanded section-by-section guides with templates; added Placeholder Syntax with curly braces (`{}`). |
| v1.1 | Fixed missing Outputs entry in the recommended section order table. |
| v1.0 | Initial release. |

### v3.0–v3.2 Roll-Forward (2026-08-26)

The v3.0 mood rule was applied project-wide in a dedicated fix pass rather than by
re-auditing each persona individually. Every Operating Philosophy section across all
three suites was de-imperativised, and `scripts/lib/philosophy-tone.js` was added to
the build as a standing guard — `node scripts/build-personas.js --check` now runs it
over all three suite `src/content/` directories and `personas/shared/partials/`. That
check is clean as of this update.

Personas already holding a v2.9 PASS were therefore rolled forward to v3.2 without a
fresh audit. Neither v3.1 nor v3.2 adds a persona-level requirement beyond the v3.0
mood rule: v3.1 governs principle naming across a suite (already covered by the
project's C5c registry), and v3.2 concerns personas authored with no build step, which
does not apply to a persona in a built suite.

Personas that were never audited stay unaudited. The tone fix covers only the
philosophy mood rule, not the rest of the Quality Checklist.

## Tracking

Status values: `—` not started · `IN PROGRESS` · `PASS` · `NEEDS WORK` · `DONE` (fixes applied)

Sorted oldest-first within each suite so the most outdated personas are at the top.

### Ledger Suite (9 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Project Manager | v3.8.0 | 2026-08-04 | v2.4 | — | — | |
| 2 | Release Engineer | v3.7.4 | 2026-08-04 | v2.4 | — | — | |
| 3 | Synthesis | v3.11.0 | 2026-08-24 | v2.8 | — | — | |
| 4 | QA | v3.9.1 | 2026-08-25 | v2.8 | — | — | |
| 5 | Security Auditor | v3.9.1 | 2026-08-25 | v2.8 | — | — | |
| 6 | Documentation | v3.10.1 | 2026-08-25 | v2.8 | — | — | |
| 7 | Planner | v2.2.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 8 | Developer | v3.11.0 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 9 | Reviewer | v3.10.2 | 2026-08-26 | v3.0 | — | — | Tone fix only |

### Standalone Suite (24 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Planner (Standalone) | v2.0.1 | 2026-07-21 | v2.4 | — | — | |
| 2 | Usage Scenarios Curator | v1.2.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 3 | Persona Curator | v1.11.0 | 2026-08-26 | v3.2 | — | — | Self-audit pending |
| 4 | Changelog Curator | v1.5.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 5 | Composer Curator | v1.1.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 6 | Git Committer | v1.8.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 7 | AGENTS.md Curator | v1.5.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 8 | Communications Curator | v1.1.0 | 2026-08-26 | v2.9 | v3.2 | PASS | Rolled forward |
| 9 | CTX Architect | v1.3.2 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 10 | Dependency Curator | v1.2.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 11 | Developer (Standalone) | v1.9.0 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 12 | Documentation (Standalone) | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 13 | Manifest Curator | v1.2.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 14 | Module Intent Architect | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 15 | Plan Architect Reviewer | v2.3.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 16 | Plan Auditor | v1.9.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 17 | Plan Refiner | v1.6.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 18 | README Curator | v1.5.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 19 | Recipe Curator | v1.11.1 | 2026-08-26 | v2.9 | v3.2 | PASS | Rolled forward |
| 20 | Researcher | v1.3.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 21 | Unit Test Auditor | v1.2.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 22 | Web GUI Specialist | v1.4.0 | 2026-08-26 | v2.9 | v3.2 | PASS | Rolled forward |
| 23 | WHATSNEW Curator | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 24 | Workspace Architect | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |

### Ledger Support Suite (11 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Ledger Claude Coordinator | v1.0.0 | 2026-03-19 | v<1.0 | — | — | |
| 2 | Ledger Orchestrator Runner | v1.5.1 | 2026-03-26 | v1.0 | — | — | |
| 3 | Ledger Dependency Sequencer | v1.3.0 | 2026-07-06 | v2.2 | — | — | |
| 4 | Ledger Pipeline Configurator | v1.1.0 | 2026-07-09 | v2.2 | — | — | |
| 5 | Ledger Bootstrapper | v1.3.0 | 2026-08-04 | v2.4 | — | — | |
| 6 | Ledger Standalone Archiver | v1.7.0 | 2026-08-21 | v2.5 | — | — | |
| 7 | Ledger Doctor | v1.3.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 8 | Ledger Knowledge Archiver | v1.8.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 9 | Ledger Knowledge Curator | v1.2.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 10 | Ledger Orchestrator Archaeologist | v1.0.2 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 11 | Ledger WP Decomposer | v1.3.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |

> **"Tone fix only"** marks a persona whose Operating Philosophy was corrected for the
> v3.0 mood rule but which has never passed a full Quality Checklist audit. It still
> counts as unaudited.

## Summary

| Suite | Total | Audited at v3.2 | Unaudited | Remaining |
|---|---|---|---|---|
| Ledger | 9 | 0 | 9 | 9 |
| Standalone | 24 | 21 | 3 | 3 |
| Ledger Support | 11 | 0 | 11 | 11 |
| **Total** | **44** | **21** | **23** | **23** |
