# Insights Sidecar File — Reference & Integration Guide

> Reference specification for the shared `insights.jsonl` sidecar file, and integration
> instructions for adding Incremental Capture to all insight-gathering personas.

**Version:** 1.2
**Last Updated:** 2026-08-21
**Author:** Sebastian Mordziol
**Applies to:** Developer, QA, Reviewer, Security Auditor, Documentation, Web GUI Specialist agents and synthesis consumers (and any future persona with an observation side-channel)

**Changelog**

- v1.2 - 2026-08-21: Resolved all placeholder rows in the integration table; split integration template into append-time and report-time blocks; replaced mixed JSON/placeholder schema with concrete example plus field table; added Step 1b (action gate), Step 6 (Rework Handling), Consumption subsection, verdict-affecting findings rule, and Location subsection with two-rung ladder; extended Curator Verification Checklist; added Web GUI Specialist, ledger Synthesis, and standalone Developer rows.
- v1.1 - 2026-08-21: Switched sink format from markdown lines to JSONL (flat, string-only schema); added lenient-consumption rule; added corroboration semantics for cross-agent duplicates.
- v1.0 - 2026-08-21: Initial release (markdown line format).

## Purpose & Rationale

Insight gathering is a **continuous, triggerless duty**: nothing in a session ever
prompts the agent to perform it. It relies on the model spontaneously re-surfacing
the instruction while absorbed in its primary task — the class of instruction that
degrades first in long sessions, and degrades silently.

A mandatory output slot in the final report (the *forcing function*) guarantees the
slot gets filled, but not that observation happened *during* the work. An agent that
stopped observing mid-session will back-fill plausible observations from context at
report time — **end-of-session reconstruction**. This misses anything only salient
in the moment and loses everything that context compaction has discarded.

The sidecar file fixes this by giving each observation its own micro-checkpoint:

- **Capture at the moment of noticing.** One append per observation, as it occurs.
- **Compaction-proof.** The file survives context loss; in-context recall does not.
- **Rehearsal effect.** Each append re-surfaces the observer duty itself, keeping
  the instruction warm across the session.
- **Audit trail.** The file demonstrates that insights were gathered in-flight
  rather than reconstructed at handoff.

The sink uses only filesystem access — a capability every affected persona already
declares. It works identically in VS Code Chat and the LangGraph orchestrator and
depends on no environment-specific tool.

## The Sink File

| Property | Value |
|---|---|
| **Filename** | `insights.jsonl` |
| **Format** | JSON Lines — exactly one flat JSON object per line. Chosen because it is structurally append-only, unambiguous to parse (observation text is full of colons, `::` identifiers, and paths that break delimiter-based formats), and machine-consumable by future tooling without a parsing project. |
| **Location** | Resolved via a two-rung ladder (see [Location](#location) below). Rung 1: the plan folder (beside `plan.md`). Rung 2: `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl` relative to the repository root. |
| **Scope** | One file per plan. All insight-gathering personas working on that plan append to the same file. |
| **Classification** | Generated working evidence — **not** a source handoff artifact (same class as `scenario-coverage.md`). It is a data collection artifact, not an actively used file: no agent reads it mid-session. |
| **Retention** | Retain in the plan folder after each agent's report is written. Archived with the folder. Never deleted by any persona. |
| **Failure mode** | Non-blocking. If the file cannot be written, the agent continues and captures observations directly in its report. The sink is a reliability aid, not a gate. |

## Entry Format

Each observation is exactly one flat JSON object, appended as a single line to the
end of the file. Example:

```jsonl
{"agent": "Developer", "priority": "medium", "type": "code-smell", "loc": "src/ledger/Reconciler.php", "text": "Reconciler::reconcile() mixes fetch, diff, and persist concerns - extract diff step into its own method."}
```

| Field | Type | Rules |
|---|---|---|
| `agent` | string | Short persona name (`Developer`, `QA`, `Reviewer`, `Security Auditor`, `Documentation`, `Web GUI Specialist`). Required — the shared file makes attribution load-bearing. |
| `priority` | string | `high` / `medium` / `low`, per the appending persona's priority guidelines. |
| `type` | string | From the appending persona's own type vocabulary (e.g., the Developer's `code-smell`, `refactor`, `improvement`, `debt`, `convention`). Lowercase kebab-case. Each persona defines its vocabulary in its own insight section. |
| `loc` | string | File path, module, or component the observation concerns. |
| `text` | string | Specific and actionable. State what could be done, not merely that something is bad. |

**Schema rules:**

- **Flat and string-only.** All five values are strings. No nesting, no arrays, no
  additional keys. This minimizes escaping surface — the dominant failure mode for
  agent-written JSON is quote-escaping errors in shell appends.
- **One object per line.** Never pretty-print, never wrap, never emit multiple
  objects on one line.
- **Optional `wp` field** (string) may be added in work-package contexts to record
  the WP identifier. No other extensions without updating this reference.

**Example file state after two stages:**

```jsonl
{"agent": "Developer", "priority": "medium", "type": "code-smell", "loc": "src/ledger/Reconciler.php", "text": "Reconciler::reconcile() mixes fetch, diff, and persist concerns - extract diff step into its own method."}
{"agent": "Developer", "priority": "low", "type": "convention", "loc": "src/ledger/Reconciler.php", "text": "Mixed camelCase/snake_case locals within the same method."}
{"agent": "Developer", "priority": "high", "type": "debt", "loc": "src/config/loader.php", "text": "Config path is hard-coded; blocks per-environment overrides. Make configurable."}
{"agent": "QA", "priority": "medium", "type": "test-gap", "loc": "tests/LedgerReconcilerTest.php", "text": "No coverage for empty-batch input; AC-3 only covered by the happy path."}
{"agent": "QA", "priority": "high", "type": "debt", "loc": "src/config/loader.php", "text": "Hard-coded config path forced test to monkey-patch the loader; same issue Developer likely hit."}
```

## Behavioral Rules

These rules apply identically to every persona that writes to the sink:

1. **Append-only during work.** Add one JSON line per observation at the moment it
   is noticed. Never re-read, edit, reorganize, or deduplicate the file mid-session —
   curation happens exactly once, when writing the final report.
2. **Do not deduplicate against other agents.** Append your observation even if
   another agent has plainly recorded the same issue. Cross-agent duplicates are
   *independent corroboration*, not noise — they raise confidence that the issue
   needs handling.
3. **Curate only your own entries.** When compiling the insight section of your
   report, read `insights.jsonl`, filter to your `agent` value, and curate those
   entries (dedupe your own repeats, refine wording, confirm priorities). Entries
   from other agents are read-only context: never modify, remove, or re-report
   them as your own — but you may note corroboration where your entry overlaps
   with another agent's (e.g., "also flagged by QA").
4. **Compile from the sink, not from recall.** The report's insight section is
   written from the file's contents. Do not write it from memory of the session.
5. **Consume leniently.** When reading the file, treat any line that fails to
   parse as JSON as a free-text observation and salvage its content — never
   silently discard it. The sink degrades gracefully; only external machine
   tooling parses strictly (skip-and-log).
6. **Forcing function keys off the sink.** If your `agent` value has no entries in
   `insights.jsonl` (or the file is absent) at report time, record a single
   observation of your nothing-found type stating that the material you touched
   was clean. This confirms you actively looked.
7. **Non-blocking fallback.** If an append fails for any reason, continue working
   and capture observations directly in your report. Never let the sink block or
   delay the primary task.
8. **No cross-agent coordination.** The pipeline's stage ordering guarantees
   sequential access; agents never write concurrently. Do not implement locking,
   merging, or conflict handling. (If an environment ever parallelizes stages,
   fall back to per-agent files `insights-{agent}.jsonl` — a curator decision,
   not an agent decision.)

## Location

The sink path is resolved once at session start via a two-rung ladder:

| Rung | Condition | Sink path |
|---|---|---|
| 1 | The session is plan-driven — `plan.md` is present in the working folder, or a plan folder path was supplied by the pre-flight | `{plan folder}/insights.jsonl` |
| 2 | Otherwise | `docs/agents/insights/{YYYY-MM-DD}-{slug}.jsonl`, relative to the repository root; created if absent |

Rung 1 is the path every plan-driven persona takes. Rung 2 exists as a defined
fallback for sessions with no plan document.

**Rung 2 properties** (differ from rung 1):

- **Per session, not per plan.** Outside a plan there is no shared unit of work, so
  the file is scoped by date and slug rather than by folder. Cross-agent
  corroboration does not apply.
- **`{slug}` is derived, never invented** — kebab-cased from the same source the
  persona already uses to title its report. Two agents in one session must resolve
  to the same filename.
- **Gitignored, not archived.** `docs/agents/insights/` is intended to be
  gitignored in consuming repositories. Rung 2 files sit entirely outside the
  derived-evidence classification — no Git Committer relocation rule, no archival
  boundary. Retention is "kept until the user prunes"; no persona reads a rung 2
  file from a later session.

## Consumption

**Producing personas** (Developer, QA, Security Auditor, Reviewer, Documentation,
Web GUI Specialist) filter to their own `agent` value when compiling report
sections. Other agents' entries are read-only context.

**Synthesis consumers** (ledger Synthesis, standalone Developer, Web GUI Specialist
at report time) read **all agents' entries**, grouped by agent and ordered by
priority. Cross-agent duplicates are surfaced as corroboration, not deduplicated.

## Verdict-Affecting Findings

No finding that determines a persona's PASS/FAIL decision may be routed through the
sink. The sink is derived working evidence that no downstream agent reads
mid-session. Confirmed vulnerabilities, risks, blocking findings,
`documentation-forward` items, and `reviewer-applied-fix` records go through the
persona's primary findings channel only and are never written to `insights.jsonl`.

## Integration Instructions (Persona Curator)

Apply the following changes to each affected persona. The insight-section name and
type vocabulary differ per persona; the mechanics do not.

| Persona | Insight section to modify | Report destination |
|---|---|---|
| Developer (ledger) | Code Insight Observer | `ledger_complete_pipeline` comments |
| Developer (standalone) | Code Insight Observer | `synthesis.md` → Code Insights |
| QA | Test Insight Observer | `ledger_complete_pipeline` comments |
| Reviewer | Review Insight Observer | `ledger_complete_pipeline` comments |
| Security Auditor | Security Insight Observer | `ledger_complete_pipeline` comments |
| Documentation | Documentation Insight Observer | `ledger_complete_pipeline` comments |
| Web GUI Specialist | Interface Insight Observer | `synthesis.md` → Interface Insights |
| Synthesis (ledger) | *(consumer only — no observer section)* | `synthesis.md` → Code Insights |

**Step 1a — Insert the append-time capture block** into the persona's insight
section, after its type/priority definitions. This block carries the rules that
fire during the work — sink path, JSONL schema, append-only discipline. The
content is delivered via the `insight-capture` shared partial, parameterised by
the persona's `insight_agent` YAML field.

The block must include:

- Sink location resolved via the two-rung ladder (see [Location](#location)).
- A complete, valid JSONL example line using the persona's own agent value — never
  a half-substituted `{PLACEHOLDER}` template.
- Append-only rule, cross-agent duplicate rule, non-blocking fallback, and
  generated-evidence retention note.

**Step 1b — Add an action gate.** Bind the append duty to a named step of the
persona's own Operational Protocol. The capture partial in the observation section
*describes* the sink; the action gate *triggers* appends at the point where
observations actually occur. Without an action gate, the capture instruction is a
triggerless duty — the same failure mode the sidecar exists to fix.

Each persona's gate must name a real, numbered protocol step and state when to
append. Examples:

| Persona | Gate location | Gate substance |
|---|---|---|
| Developer | Step 3 (Incremental Implementation) | After each implementation chunk, append observations from that chunk before starting the next. |
| QA | Verification Stack step (after Edge-Case Stress Test) | After each verification layer, append observations that layer surfaced. |
| Security Auditor | Audit pass step | After each audit area, append non-blocking observations before moving to the next area. |
| Reviewer | Step 2 (The Deep Dive) | Append each Gold Nugget or out-of-scope pattern as it is noticed, not at the end of the dive. |
| Documentation | Documentation pass step | After each document updated, append any gap or staleness noticed in adjacent documentation. |
| Web GUI Specialist | Implementation step | After each component or view is implemented and visually verified, append observations from that surface. |

**Step 2 — Insert the report-time compilation block** beside the persona's
output-format / report-template section. This block carries the rules that fire
while writing the report — compile from sink, own-agent filter, curation, lenient
consumption, forcing function. The content is delivered via the
`insight-compilation` shared partial, parameterised by `insight_agent` and
`insight_report_target`.

The block must include:

- Compile from the sink, filtered to the persona's own `agent` value.
- Curate own entries only; other agents' entries are read-only context.
- Note cross-agent corroboration where entries overlap.
- Lenient consumption: salvage unparseable lines as free text.
- Forcing function: if no own-agent entries exist (or the file is absent), record
  a single `improvement` observation confirming the material was clean.

**Step 3 — Rekey the forcing function.** Locate the persona's existing
"always record at least one observation" rule and rephrase it to reference the
sink, preserving its intent. If the persona has no such rule, the forcing function
in the compilation block (Step 2) is sufficient.

**Step 4 — Amend the report workflow step.** Change the step that writes the
persona's report so the insight section is explicitly compiled from the sink,
e.g. for the Developer:

> Create or overwrite `synthesis.md` … compiling Code Insights from your entries
> in `insights.jsonl` per Incremental Capture, noting cross-agent corroboration
> where present.

**Step 5 — Leave type vocabularies persona-specific.** Do not unify observation
types across personas. Each persona keeps (or gains) its own vocabulary suited to
its lens; the shared file only standardizes the line format and the agent tag.

**Step 6 — Extend Rework Handling.** In the persona's Rework Handling section, add
a line stating that insight capture continues during rework — the action gate is in
the full Operational Protocol which rework sections instruct agents not to re-run,
so the rework section must independently state that appending continues. Exempt
personas that have no `REWORK` action (currently: Security Auditor and Reviewer —
their re-entry paths re-run the full protocol including the action gate).

**Step 7 — Do not add lifecycle duties.** No persona creates the file ahead of
time (first append creates it), rotates it, or cleans it up. Archival is handled
by the existing archiver flow, which takes the plan folder wholesale.

## Curator Verification Checklist

After modifying each persona, verify:

- [ ] Append-time capture block present (via `insight-capture` partial), with sink
      path resolved via the two-rung ladder, the flat JSONL schema rendered as a
      complete valid example line (no `{PLACEHOLDER}` markers), and append-only rule.
- [ ] Report-time compilation block present (via `insight-compilation` partial),
      placed beside the output-format section — not in the same location as the
      capture block.
- [ ] Action gate present: names a real, numbered step of the persona's own
      Operational Protocol and states when to append.
- [ ] Cross-agent duplicate rule present: append regardless of other agents'
      entries; corroboration noted at report time, never deduped away.
- [ ] Lenient consumption rule present: unparseable lines salvaged as free-text,
      never discarded.
- [ ] Forcing function rekeyed to the sink (no own-agent entries, or file absent),
      with the persona's nothing-found type named.
- [ ] Report workflow step compiles the insight section from the sink, filtered
      to the persona's own entries, noting corroboration.
- [ ] Non-blocking fallback stated; sink failure cannot gate the primary task.
- [ ] No mid-session curation, no cross-agent edits, no file lifecycle duties added.
- [ ] Persona's own type vocabulary unchanged (or defined, if the persona lacked one).
- [ ] Scope & Boundaries table present with three or four rows defining the
      persona's observation territory — not a clone of another persona's table.
- [ ] Rework Handling section states that capture continues during rework, **or**
      the persona is named as exempt (no `REWORK` action exists for its pipeline).
- [ ] The persona has at most one continuous side-channel; checkpoint-slotted
      partials (e.g., `ax-feedback`) do not count.
- [ ] The sink location uses the two-rung ladder — no reference to "WP's working
      folder" or any other undefined location remains.
- [ ] The persona still reads correctly top-to-bottom; the addition did not
      duplicate rules already stated elsewhere in the persona.
