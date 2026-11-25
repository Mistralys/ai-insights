# Persona Audit Status — Design Guide v3.11

<!-- GENERATED FILE — do not edit by hand.
     Regenerate: node scripts/cli.js generate-persona-audit
     Narrative: notes.md · Notes-column text: annotations.json -->

**Generated:** 2026-11-25
**Guide Version:** 3.11

> **Companion:** [notes.md](notes.md) — audit methodology, generalising findings, and
> roll-forward reasoning. Editorial text in the Notes column below comes from
> [annotations.json](annotations.json); the Tier column is computed from persona source.

## Audit Focus

Recent guide updates that personas should be checked against:

| Guide Version | Key Changes |
|---|---|
| v3.11 | The file a sub-agent writes its result to is part of the task, not the method. Claude Code tells every sub-agent to return findings as a reply instead of writing report files; once v3.10 kept output formats out of dispatch prompts, nothing in the prompt overrode that note, and sub-agents whose file the next agent reads stopped writing it. The dispatch prompt now names the output file, and Platform Dispatch Arguments records the note. Widened the Pattern 9 rule and the checklist item, and added the "Output file left out of the prompt" pitfall. |
| v3.10 | A dispatch prompt now carries the task and never the method. A persona sub-agent already holds its workflow, format rules and quality checks; steps restated in the prompt override them, because the sub-agent takes the prompt as the specific instruction for this task. A generic agent with no persona is the opposite case, and its prompt supplies the method in full. Widened the Pattern 9 rule, added a design rule, a checklist item and the "Method in the prompt" pitfall. |
| v3.9 | Platform Dispatch Arguments now covers waiting. On Claude Code a dispatch returns before the sub-agent finishes, a foreground request is ignored, and the end of the wait arrives as a message; a persona that does not say how to wait leaves the agent to invent a polling condition, which can be one that never comes true. Naming a sub-agent can also start it as an agent-team teammate. Added two Pattern 9 design rules, a checklist item and the "Invented wait condition" pitfall. |
| v3.8 | Nested Delegation now states when it applies. Two calls meet on one item only when a sub-agent can dispatch an owner the caller or a sibling also dispatches. A one-way chain, where no dispatch target appears twice, needs neither a plan nor the deferral conditions. The design rule, the checklist item and the Concept Index entry carry the same condition. |
| v3.7 | Added "Nested Delegation" to Pattern 9. A sub-agent is often an orchestrator itself, so two calls can reach the same owner for the same item. A ban on further dispatch discards the sub-agent's own judgement; the caller passes its plan with a status per item instead, settles any question the sub-agent would stop to ask, and the sub-agent's numbered dispatch steps defer to that plan, treating a skipped item as already decided. Added a Pattern 15 rule (a caller's prompt does not outrank a numbered step), a checklist item and the "Dispatch ban" pitfall. |
| v3.6 | Added "Platform Dispatch Arguments" to Pattern 9. Each platform's dispatch tool selects the sub-agent through a different argument, `description` is a label on some platforms and the whole task on another, and Claude Code silently starts a generic agent when the selector is missing. The delegation templates now name the selector instead of assuming one platform. Added two design rules (name the selector; pass inputs, never an identity), a checklist item and the "Dispatch by label" pitfall. |
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
| 1 | Planner | v2.13.0 | 2026-10-01 | v3.6 | v3.4 | B (13p/1c) | PASS (v3.4) | Paired audit with standalone twin; v3.3/v3.4 delta pass applied — rendered read caught a missing Outputs entry |
| 2 | Project Manager | v3.15.0 | 2026-10-29 | v3.11 | — | B (12p/8c) | — |  |
| 3 | Reviewer | v3.12.2 | 2026-10-29 | v3.11 | v3.5 | B (13p/5c) | PASS (v3.5) | First full audit — 17 findings, all resolved; gained Strict Constraints, Outputs, Capabilities, and Rework Handling |
| 4 | Release Engineer | v3.11.2 | 2026-10-29 | v3.11 | — | B (15p/8c) | — |  |
| 5 | Documentation | v3.13.2 | 2026-10-29 | v3.11 | — | B (16p/7c) | — |  |
| 6 | Developer | v3.21.0 | 2026-11-25 | v3.11 | v3.3 | B (24p/4c) | PASS (v3.3) | Paired audit with standalone twin — 11 findings, all resolved |
| 7 | QA | v3.11.0 | 2026-11-25 | v3.11 | — | B (14p/5c) | — |  |
| 8 | Security Auditor | v3.11.0 | 2026-11-25 | v3.11 | v3.4 | B (14p/5c) | PASS (v3.4) | First audit — 17 findings resolved, 1 withdrawn; Medium severity now blocks, and the audit runs area-by-area with capture interleaved |
| 9 | Synthesis | v3.16.0 | 2026-11-25 | v3.11 | — | B (12p/6c) | — |  |

### Standalone Suite (24 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Communications Curator | v1.1.1 | 2026-09-18 | v3.5 | v3.2 | B (1p/0c) | PASS (v3.2) |  |
| 2 | Composer Curator | v1.1.1 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 3 | Dependency Curator | v1.3.1 | 2026-09-18 | v3.5 | v3.2 | B (4p/0c) | PASS (v3.2) |  |
| 4 | Recipe Curator | v1.11.2 | 2026-09-18 | v3.5 | v3.3 | A | PASS (v3.3) |  |
| 5 | Unit Test Auditor | v1.2.2 | 2026-09-18 | v3.5 | v3.2 | B (1p/0c) | PASS (v3.2) |  |
| 6 | Module Intent Architect | v1.1.2 | 2026-09-29 | v3.6 | v3.3 | A | PASS (v3.3) |  |
| 7 | Planner (Standalone) | v2.7.0 | 2026-10-01 | v3.6 | v3.4 | B (6p/0c) | PASS (v3.4) | Paired audit with ledger twin; v3.3/v3.4 delta pass applied |
| 8 | CTX Architect | v1.4.0 | 2026-10-16 | v3.7 | v3.3 | A | PASS (v3.3) | Principle renamed to canonical "Every Artefact Earns Its Place" (C5c) |
| 9 | Git Committer | v1.10.0 | 2026-10-16 | v3.7 | v3.3 | A | PASS (v3.3) |  |
| 10 | Persona Curator | v1.17.1 | 2026-10-16 | v3.7 | v3.4 | A | PASS (v3.4) | Full self-audit at v3.2, rolled forward |
| 11 | Changelog Curator | v1.7.2 | 2026-10-19 | v3.8 | v3.2 | B (5p/0c) | PASS (v3.2) |  |
| 12 | WHATSNEW Curator | v1.5.2 | 2026-10-19 | v3.8 | v3.7 | B (1p/0c) | PASS (v3.7) |  |
| 13 | AGENTS.md Curator | v2.7.2 | 2026-10-29 | v3.11 | — | B (3p/1c) | — |  |
| 14 | Documentation (Standalone) | v1.7.2 | 2026-10-29 | v3.11 | v3.2 | B (6p/1c) | PASS (v3.2) |  |
| 15 | Plan Refiner | v1.10.1 | 2026-10-29 | v3.11 | v3.2 | B (3p/8c) | PASS (v3.2) |  |
| 16 | README Curator | v1.10.2 | 2026-10-29 | v3.11 | v3.4 | B (4p/1c) | PASS (v3.4) |  |
| 17 | Workspace Architect | v1.9.2 | 2026-10-29 | v3.11 | v3.3 | B (2p/3c) | PASS (v3.3) | 7 findings, all resolved — 2 were rendered-output defects invisible in source |
| 18 | Manifest Curator | v2.0.0 | 2026-11-10 | v3.11 | v3.4 | B (2p/2c) | PASS (v3.4) |  |
| 19 | Developer (Standalone) | v1.22.0 | 2026-11-25 | v3.11 | v3.3 | B (16p/3c) | PASS (v3.3) | Paired audit with ledger twin — 11 findings, all resolved |
| 20 | Plan Architect Reviewer | v2.6.0 | 2026-11-25 | v3.11 | v3.2 | B (4p/2c) | PASS (v3.2) |  |
| 21 | Plan Auditor | v1.14.0 | 2026-11-25 | v3.11 | v3.2 | B (2p/0c) | PASS (v3.2) |  |
| 22 | Researcher | v1.5.0 | 2026-11-25 | v3.11 | v3.3 | B (3p/1c) | PASS (v3.3) |  |
| 23 | Usage Scenarios Curator | v1.3.0 | 2026-11-25 | v3.11 | — | B (1p/0c) | — | Tone fix only |
| 24 | Web GUI Specialist | v1.11.0 | 2026-11-25 | v3.11 | v3.2 | B (8p/2c) | PASS (v3.2) |  |

### Ledger Support Suite (12 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Tier | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | Ledger Orchestrator Archaeologist | v1.0.3 | 2026-09-18 | v3.5 | — | A | — | Tone fix only |
| 2 | Ledger Knowledge Archiver | v1.9.2 | 2026-09-29 | v3.6 | v3.4 | A | PASS (v3.4) | First audit — 14 findings, all resolved; Mode A read a sidecar the ledger agents stopped writing, and two commit parameters had no Mode A source |
| 3 | Ledger Knowledge Curator | v1.4.2 | 2026-09-29 | v3.6 | v3.4 | A | PASS (v3.4) | First audit — 15 findings, all resolved; MERGE had no legal deletion path and RESCOPE contradicted the no-creation rule |
| 4 | Ledger Orchestrator Runner | v1.5.2 | 2026-09-29 | v3.6 | — | A | — |  |
| 5 | Ledger Doctor | v1.3.3 | 2026-10-06 | v3.6 | — | A | — | Tone fix only |
| 6 | Ledger Bootstrapper | v1.5.0 | 2026-10-15 | v3.6 | v3.4 | B (3p/0c) | PASS (v3.4) | First audit — 10 findings, all resolved; two required parameters had no documented source |
| 7 | Ledger Synthesis Maintainer | v3.0.0 | 2026-10-23 | v3.8 | — | B (3p/0c) | — | First audit — 16 findings, all resolved; Inputs described a three-way choice the subagent dispatch never offers, and Outputs omitted the file it writes |
| 8 | Ledger Dependency Sequencer | v1.5.1 | 2026-10-28 | v3.11 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 9 findings, all resolved; density delta pass applied at v3.4 |
| 9 | Ledger Pipeline Configurator | v1.4.1 | 2026-10-28 | v3.11 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 14 findings, all resolved; Capabilities had never authorised the codebase reads its own criteria required |
| 10 | Ledger WP Decomposer | v1.10.1 | 2026-10-28 | v3.11 | v3.4 | B (1p/0c) | PASS (v3.4) | First audit — 20 findings, all resolved; roster partial fixed for all 4 pipeline personas |
| 11 | Ledger Claude Coordinator | v3.5.0 | 2026-11-25 | v3.11 | v3.5 | B (2p/0c) | PASS (v3.5) |  |
| 12 | Ledger Task Curator | v1.0.1 | 2026-11-25 | v3.11 | v3.11 | A | PASS |  |

## Summary

| Suite | Total | Current | Stale | Unaudited | Remaining |
|---|---|---|---|---|---|
| Ledger | 9 | 0 | 4 | 5 | 9 |
| Standalone | 24 | 0 | 22 | 2 | 24 |
| Ledger Support | 12 | 1 | 7 | 4 | 11 |
| **Total** | **45** | **1** | **33** | **11** | **44** |

**Stale** personas hold a real PASS at an older guide version — their remaining work
depends on tier. **Unaudited** personas have never been through a Quality Checklist at
any version, and that is where the substantive backlog sits.

Of the 33 stale, 25 are Tier B (composed — need a rendered read) and
8 are Tier A (no composition — eligible for roll-forward on the guide's own terms).
