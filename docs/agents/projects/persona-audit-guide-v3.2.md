# Persona Audit — Design Guide v3.2

**Created:** 2026-08-26
**Guide Version:** 3.2
**Mode:** Audit

## Audit Focus

Recent guide updates that personas should be checked against:

| Guide Version | Key Changes |
|---|---|
| v3.3 | Added "Verifying Rendered Output" — where a build system assembles the persona, the rendered document is read end to end after every change, since partials and variables hide duplication, wrong substitutions and tone breaks that only the assembled document reveals. |
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

### Persona Curator Self-Audit (2026-08-26)

The Persona Curator was audited in full against v3.2 rather than rolled forward, since it
is the persona that performs every other audit. Ten findings: one Critical (no `Outputs`
section), two Major (no `Decision Logic` behind its own PASS/NEEDS WORK verdict; a
reproduced Quality Checklist that had drifted eleven items behind the guide), seven Minor.
Nine were applied in `v1.12.0`. The tenth — `## Strict Constraints` → `## Core Rules` — was
flagged rather than applied, since it is a heading change in a published artifact; the user
confirmed no consumer keys on that heading and it landed in `v1.13.0` together with the
categorized rule groups the guide pairs with that name.

Two findings generalise beyond this persona and are worth checking for elsewhere:

- **A reproduced guide checklist drifts silently.** A persona that copies the guide's
  Quality Checklist inline reads as thorough while validating against a stale list. The fix
  is a reference to the guide plus only the genuine local additions.
- **A verdict without a threshold.** Any persona issuing PASS/FAIL needs `Decision Logic`
  saying which severities block. Severity definitions classify *findings*, not verdicts.

### Paired Planner Audit (2026-08-26)

The two Planner personas were audited together rather than separately, because ~80% of their
content was byte-identical with no partial extraction. Auditing either one alone would have
produced findings that silently applied to the other.

Four drift points had already materialised in the fork, each a place where one twin was fixed
and the other was not:

| Divergence | Ledger | Standalone |
|---|---|---|
| Research Brief subsection | `Patterns & Conventions` | `Established Patterns` (renamed 2026-07-21 — never crossed over) |
| Deferred synthesis items | Triaged, preserved in a table | Discarded outright — a direct contradiction |
| Acceptance criteria | `AC-{NN}` stable IDs | Unnumbered, though its own Test Plan slot cited criterion IDs |
| Operating Philosophy | Present | Absent entirely |

Six `planner-*` partials now hold the shared content, gated by `has_mcp` and a new
`has_ledger_workflow` flag. Source dropped 283→133 (ledger) and 227→103 (standalone) lines.

Three lessons that generalise:

- **A forked persona pair needs a paired audit.** Divergences are only visible side by side.
  A "similar" pair with no partial is a fork, and the drift is the finding.
- **Same principle, different domain, one canonical name.** The Planner philosophy carries the
  same three registry names as the Developer philosophy with planning-domain bodies. Two partials
  under shared names is the guide's "bodies are authored, not copied" rule across suites, not a
  name collision.
- **A manifest can run ahead of the code.** `api-surface.md` already listed
  `planner-core-rules.md` and `planner-output-template.md` as shared partials before either
  existed. A manifest entry is not evidence that the file is there.

### Paired Developer Audit (2026-08-27)

The two Developer personas were audited together against v3.3. Six shared partials were already in
place, so the fork risk was largely contained — the drift had concentrated in the *non-shared*
verification and output sections, which is where a paired audit earns its keep.

| Divergence | Ledger | Standalone |
|---|---|---|
| Verification | One fused `Verify & Refine` step | Split into Build & Regression / Acceptance Tests / Static Analysis (v1.8.0 — never crossed over) |
| Output structure | `## Output Format` prose, placed after Constraints | Synthesis template, correctly placed before Constraints |
| No-counts restatement | Constraints only | Restated in three template slots |
| Constraint mood | "**Avoid** embedding counts" | "**Never** embed counts" |

The standalone carried the one Critical finding: its `cc_tools` override had dropped `Task`, `Write`
and `Glob` while the persona still instructed *"Use the `Task` tool"* for the archiver dispatch and
required writing `synthesis.md`. A tool grant and the instructions that depend on it live in
different files, so neither reads as wrong on its own.

Three lessons that generalise:

- **Partial extraction contains fork drift but does not end it.** Every divergence found sat in a
  section that had never been extracted. Where two personas share partials, the audit's attention
  belongs on what remains inline.
- **A `cc_tools` override is a silent contract with the content file.** Narrowing an inherited tool
  list can revoke a tool the persona's own instructions command. Any override warrants a check
  against the content file's tool references.
- **Rendered-output reading (v3.3) pays off immediately.** Two findings — a partial-vs-section
  duplication and a paragraph absorbed into a bullet list by a conditional block — existed only in
  the assembled document. Neither was visible in any source file or diff.

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
| 7 | Planner | v2.3.0 | 2026-08-26 | v3.2 | v3.2 | DONE | Paired audit with standalone twin — 13 findings, all resolved |
| 8 | Reviewer | v3.10.2 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 9 | Developer | v3.16.0 | 2026-08-27 | v3.3 | v3.3 | DONE | Paired audit with standalone twin — 11 findings, all resolved |

### Standalone Suite (24 personas)

| # | Persona | Version | Last Updated | Guide | Audited | Status | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Planner (Standalone) | v2.1.0 | 2026-08-26 | v3.2 | v3.2 | DONE | Paired audit with ledger twin — 12 findings, all resolved |
| 2 | Usage Scenarios Curator | v1.2.1 | 2026-08-26 | v3.0 | — | — | Tone fix only |
| 3 | Changelog Curator | v1.5.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 4 | Composer Curator | v1.1.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 5 | Git Committer | v1.8.0 | 2026-08-25 | v2.8 | v3.2 | PASS | Rolled forward |
| 6 | AGENTS.md Curator | v1.5.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 7 | Communications Curator | v1.1.0 | 2026-08-26 | v2.9 | v3.2 | PASS | Rolled forward |
| 8 | CTX Architect | v1.3.2 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 9 | Dependency Curator | v1.2.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 10 | Developer (Standalone) | v1.13.0 | 2026-08-27 | v3.3 | v3.3 | DONE | Paired audit with ledger twin — 11 findings, all resolved |
| 11 | Documentation (Standalone) | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 12 | Manifest Curator | v1.2.1 | 2026-08-26 | v3.1 | v3.2 | PASS | Rolled forward |
| 13 | Module Intent Architect | v1.1.1 | 2026-08-26 | v3.0 | v3.2 | PASS | Rolled forward |
| 14 | Persona Curator | v1.13.0 | 2026-08-26 | v3.2 | v3.2 | DONE | Full self-audit — 10 findings, all resolved |
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
>
> **"Rolled forward"** marks a v2.9 PASS carried to v3.2 without re-reading the persona,
> per the roll-forward note above. **"DONE"** marks a persona that went through the full
> Quality Checklist at v3.2 and had its findings applied.

## Summary

| Suite | Total | Audited | Unaudited | Remaining |
|---|---|---|---|---|
| Ledger | 9 | 2 | 7 | 7 |
| Standalone | 24 | 23 | 1 | 1 |
| Ledger Support | 11 | 0 | 11 | 11 |
| **Total** | **44** | **25** | **19** | **19** |

Of the 25 audited, 20 are roll-forwards from v2.9 and five went through a full checklist pass:
the Persona Curator, the two Planners as a pair (v3.2), and the two Developers as a pair (v3.3).
