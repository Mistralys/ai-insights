# Persona Audit Status — Design Guide v3.5

<!-- GENERATED FILE — do not edit by hand.
     Regenerate: node scripts/cli.js generate-persona-audit
     Narrative: notes.md · Notes-column text: annotations.json -->

**Generated:** 2026-09-23
**Guide Version:** 3.5

> **Companion:** [notes.md](notes.md) — audit methodology, generalising findings, and
> roll-forward reasoning. Editorial text in the Notes column below comes from
> [annotations.json](annotations.json); the Tier column is computed from persona source.

## Audit Focus

Recent guide updates that personas should be checked against:

| Guide Version | Key Changes |
|---|---|
| v3.5 | Added "The Reduction Pass" — an audit's unit is the individual statement and its remedy is almost always an addition, so auditing is monotonic and cannot find bloat, which is a property of the set rather than of any member; the pass asks what each statement buys given a competent reader, cuts multipliers before content, and treats the enforcement triple as a budget. Added the related checklist item and pitfall. |
| v3.4 | Added "Prose Density" — overloaded explanatory prose costs an instruction its trigger as well as its readability, and is removed in a dedicated pass after drafting rather than avoided while writing; added the related checklist item and pitfall. 2026-09-01: Added the "Concept Index" — the guide names its constructs and cites them by name, but the only place those names appeared together was this changelog, so resolving one meant a full-text search; added "The 60-Second Rule" as a section, having been cited by name in three places while defined only in a checklist bullet. |
| v3.3 | Added "Verifying Rendered Output" — where a build system assembles the persona, the rendered document is read end to end after every change, since partials and variables hide duplication, wrong substitutions and tone breaks that only the assembled document reveals; added the related checklist item and pitfall. |
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

## Tracking

Status values: `—` not started · `PASS` (audited at the current guide version) ·
`PASS (vX.Y)` (audited at an older version — stale).

**Tier** is computed from the persona's source composition, not recorded by hand:
**A** = no partials and no target conditionals, so the rendered output is the source
plus frontmatter and guide v3.3's rendered-output requirement does not apply.
**B (Np/Mc)** = N partial references and M conditionals, so the assembled document
must be read to be verified. A persona that gains its first partial flips A → B here
automatically, marking its existing audit stamp as no longer sufficient.

Sorted oldest-first within each suite so the most outdated personas are at the top.

### Ledger Suite (9 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Planner | v2.8.1 | 2026-09-14 | v3.5 | v3.4 | B (12p/1c) | PASS (v3.4) | Paired audit with standalone twin; v3.3/v3.4 delta pass applied — rendered read caught a missing Outputs entry |
| 2 | Project Manager | v3.9.2 | 2026-09-14 | v3.5 | — | B (10p/6c) | — |  |
| 3 | Developer | v3.17.1 | 2026-09-14 | v3.5 | v3.3 | B (20p/4c) | PASS (v3.3) | Paired audit with standalone twin — 11 findings, all resolved |
| 4 | QA | v3.9.2 | 2026-09-14 | v3.5 | — | B (13p/5c) | — |  |
| 5 | Security Auditor | v3.10.1 | 2026-09-14 | v3.5 | v3.4 | B (13p/5c) | PASS (v3.4) | First audit — 17 findings resolved, 1 withdrawn; Medium severity now blocks, and the audit runs area-by-area with capture interleaved |
| 6 | Reviewer | v3.11.1 | 2026-09-14 | v3.5 | v3.5 | B (13p/5c) | PASS | First full audit — 17 findings, all resolved; gained Strict Constraints, Outputs, Capabilities, and Rework Handling |
| 7 | Release Engineer | v3.7.5 | 2026-09-14 | v3.5 | — | B (12p/7c) | — |  |
| 8 | Documentation | v3.10.3 | 2026-09-14 | v3.5 | — | B (13p/6c) | — |  |
| 9 | Synthesis | v3.11.2 | 2026-09-14 | v3.5 | — | B (9p/4c) | — |  |

### Standalone Suite (24 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Module Intent Architect | v1.1.1 | 2026-08-26 | v3.2 | v3.3 | A | PASS (v3.3) |  |
| 2 | CTX Architect | v1.3.3 | 2026-08-27 | v3.4 | v3.3 | A | PASS (v3.3) | Principle renamed to canonical "Every Artefact Earns Its Place" (C5c) |
| 3 | AGENTS.md Curator | v2.1.1 | 2026-09-10 | v3.5 | — | B (1p/0c) | — |  |
| 4 | Documentation (Standalone) | v1.3.1 | 2026-09-10 | v3.5 | v3.2 | B (4p/0c) | PASS (v3.2) |  |
| 5 | Git Committer | v1.9.0 | 2026-09-10 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 6 | Plan Refiner | v1.6.2 | 2026-09-10 | v3.5 | v3.2 | B (0p/7c) | PASS (v3.2) |  |
| 7 | README Curator | v1.6.1 | 2026-09-10 | v3.5 | v3.4 | B (2p/0c) | PASS (v3.4) |  |
| 8 | Workspace Architect | v1.2.1 | 2026-09-10 | v3.5 | v3.3 | B (0p/2c) | PASS (v3.3) | 7 findings, all resolved — 2 were rendered-output defects invisible in source |
| 9 | Changelog Curator | v1.5.1 | 2026-09-18 | v3.5 | v3.2 | B (2p/0c) | PASS (v3.2) |  |
| 10 | Communications Curator | v1.1.1 | 2026-09-18 | v3.5 | v3.2 | B (1p/0c) | PASS (v3.2) |  |
| 11 | Composer Curator | v1.1.1 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 12 | Dependency Curator | v1.3.1 | 2026-09-18 | v3.5 | v3.2 | B (4p/0c) | PASS (v3.2) |  |
| 13 | Manifest Curator | v1.6.1 | 2026-09-18 | v3.5 | v3.4 | B (0p/1c) | PASS (v3.4) |  |
| 14 | Persona Curator | v1.17.0 | 2026-09-18 | v3.5 | v3.4 | A | PASS (v3.4) | Full self-audit at v3.2, rolled forward |
| 15 | Plan Architect Reviewer | v2.3.3 | 2026-09-18 | v3.5 | v3.2 | B (1p/1c) | PASS (v3.2) |  |
| 16 | Plan Auditor | v1.9.3 | 2026-09-18 | v3.5 | v3.2 | B (1p/0c) | PASS (v3.2) |  |
| 17 | Planner (Standalone) | v2.4.1 | 2026-09-18 | v3.5 | v3.4 | B (6p/0c) | PASS (v3.4) | Paired audit with ledger twin; v3.3/v3.4 delta pass applied |
| 18 | Recipe Curator | v1.11.2 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 19 | Researcher | v1.3.2 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 20 | Unit Test Auditor | v1.2.2 | 2026-09-18 | v3.5 | v3.2 | B (1p/0c) | PASS (v3.2) |  |
| 21 | Usage Scenarios Curator | v1.2.2 | 2026-09-18 | v3.5 | — | A | — | Tone fix only |
| 22 | WHATSNEW Curator | v1.1.2 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 23 | Developer (Standalone) | v1.15.1 | 2026-09-23 | v3.5 | v3.3 | B (10p/1c) | PASS (v3.3) | Paired audit with ledger twin — 11 findings, all resolved |
| 24 | Web GUI Specialist | v1.7.3 | 2026-09-23 | v3.5 | v3.2 | B (4p/1c) | PASS (v3.2) |  |

### Ledger Support Suite (11 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Ledger Orchestrator Runner | v1.5.1 | 2026-03-26 | v1.0 | — | A | — |  |
| 2 | Ledger Bootstrapper | v1.4.1 | 2026-09-14 | v3.5 | v3.4 | B (3p/0c) | PASS (v3.4) | First audit — 10 findings, all resolved; two required parameters had no documented source |
| 3 | Ledger Doctor | v1.3.2 | 2026-09-14 | v3.5 | — | A | — | Tone fix only |
| 4 | Ledger Knowledge Archiver | v1.9.1 | 2026-09-14 | v3.5 | v3.4 | A | PASS (v3.4) | First audit — 14 findings, all resolved; Mode A read a sidecar the ledger agents stopped writing, and two commit parameters had no Mode A source |
| 5 | Ledger Knowledge Curator | v1.4.1 | 2026-09-14 | v3.5 | v3.4 | A | PASS (v3.4) | First audit — 15 findings, all resolved; MERGE had no legal deletion path and RESCOPE contradicted the no-creation rule |
| 6 | Ledger Claude Coordinator | v2.1.0 | 2026-09-16 | v3.5 | v3.5 | B (0p/1c) | PASS |  |
| 7 | Ledger Dependency Sequencer | v1.4.5 | 2026-09-18 | v3.5 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 9 findings, all resolved; density delta pass applied at v3.4 |
| 8 | Ledger Orchestrator Archaeologist | v1.0.3 | 2026-09-18 | v3.5 | — | A | — | Tone fix only |
| 9 | Ledger Pipeline Configurator | v1.2.1 | 2026-09-18 | v3.5 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 14 findings, all resolved; Capabilities had never authorised the codebase reads its own criteria required |
| 10 | Ledger WP Decomposer | v1.5.3 | 2026-09-18 | v3.5 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 20 findings, all resolved; roster partial fixed for all 4 pipeline personas |
| 11 | Ledger Synthesis Maintainer | v2.0.0 | 2026-09-23 | v3.5 | — | B (2p/0c) | — | First audit — 16 findings, all resolved; Inputs described a three-way choice the subagent dispatch never offers, and Outputs omitted the file it writes |

## Summary

| Suite | Total | Current | Stale | Unaudited | Remaining |
|---|---|---|---|---|---|
| Ledger | 9 | 1 | 3 | 5 | 8 |
| Standalone | 24 | 0 | 22 | 2 | 24 |
| Ledger Support | 11 | 1 | 6 | 4 | 10 |
| **Total** | **44** | **2** | **31** | **11** | **42** |

**Stale** personas hold a real PASS at an older guide version — their remaining work
depends on tier. **Unaudited** personas have never been through a Quality Checklist at
any version, and that is where the substantive backlog sits.

Of the 31 stale, 21 are Tier B (composed — need a rendered read) and
10 are Tier A (no composition — eligible for roll-forward on the guide's own terms).
