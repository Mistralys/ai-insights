# Insights Sidecar File — Reference & Integration Guide

> Reference specification for the shared `insights.jsonl` sidecar file, and integration
> instructions for adding Incremental Capture to all insight-gathering personas.

**Version:** 1.1
**Last Updated:** 2026-08-21
**Author:** Sebastian Mordziol
**Applies to:** Developer, QA, Reviewer, Security Auditor, Documentation agents (and any future persona with an observation side-channel)

**Changelog**

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
| **Location** | The plan folder (beside `plan.md`). In work-package contexts, the WP's working folder equivalent. |
| **Scope** | One file per plan. All insight-gathering personas working on that plan append to the same file. |
| **Classification** | Generated working evidence — **not** a source handoff artifact (same class as `scenario-coverage.md`). It is a data collection artifact, not an actively used file: no agent reads it mid-session. |
| **Retention** | Retain in the plan folder after each agent's report is written. Archived with the folder. Never deleted by any persona. |
| **Failure mode** | Non-blocking. If the file cannot be written, the agent continues and captures observations directly in its report. The sink is a reliability aid, not a gate. |

## Entry Format

Each observation is exactly one flat JSON object, appended as a single line to the
end of the file:

```json
{"agent": "{AGENT}", "priority": "{PRIORITY}", "type": "{TYPE}", "loc": "{FILE_OR_MODULE}", "text": "{Observation and suggested follow-up}"}
```

| Field | Rules |
|---|---|
| `agent` | Short persona name (`Developer`, `QA`, `Reviewer`, `Security Auditor`, `Documentation`). Required — the shared file makes attribution load-bearing. |
| `priority` | `high` / `medium` / `low`, per the appending persona's priority guidelines. |
| `type` | From the appending persona's own type vocabulary (e.g., the Developer's `code-smell`, `refactor`, `improvement`, `debt`, `convention`). Lowercase kebab-case. Each persona defines its vocabulary in its own insight section. |
| `loc` | File path, module, or component the observation concerns. |
| `text` | Specific and actionable. State what could be done, not merely that something is bad. |

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

## Integration Instructions (Persona Curator)

Apply the following changes to each affected persona. The insight-section name and
type vocabulary differ per persona; the mechanics do not.

| Persona | Insight section to modify | Report destination |
|---|---|---|
| Developer | Code Insight Observer | `synthesis.md` → Code Insights |
| QA | {Its observation/findings side-channel section} | {Its report artifact} |
| Reviewer | {Its observation side-channel section} | {Its report artifact} |
| Security Auditor | {Its observation side-channel section} | {Its report artifact} |
| Documentation | {Its observation side-channel section} | {Its report artifact} |

**Step 1 — Insert the Incremental Capture subsection** into the persona's insight
section, after its type/priority definitions. Use this template verbatim, adjusting
only `{AGENT}` and the report reference:

```markdown
### Incremental Capture

Record observations the moment you notice them — do not defer capture to the
report step.

- **Sink file:** `insights.jsonl` in the plan folder (beside `plan.md`). The file
  is shared across agents; every entry carries an agent field.
- **Append-only during work.** Add one flat JSON object per line as each
  observation occurs:
  `{"agent": "{AGENT}", "priority": "{PRIORITY}", "type": "{TYPE}", "loc": "{FILE_OR_MODULE}", "text": "{Observation and suggested follow-up}"}`
  All values are strings; no nesting, no extra keys. Never re-read, edit, or
  reorganize the file mid-session — curation happens once, when writing your report.
- **Duplicates across agents are welcome.** Append your observation even if
  another agent has recorded the same issue — independent corroboration raises
  confidence.
- **Compile from the sink.** When writing your insight section, read
  `insights.jsonl`, filter to entries where `agent` is `{AGENT}`, and curate them
  (dedupe your own repeats, refine wording, confirm priorities). Do not write
  insights from recall. Other agents' entries are read-only context — never
  modify or re-report them, but note corroboration where they overlap with yours.
- **Consume leniently.** Salvage any line that fails to parse as JSON as a
  free-text observation; never discard it.
- **Non-blocking:** If the sink cannot be written, continue working and capture
  observations directly in your report. The sink is a reliability aid, not a gate.
- `insights.jsonl` is generated working evidence, not a source handoff artifact.
  Retain it in the plan folder; never delete it.
```

**Step 2 — Rekey the forcing function.** Locate the persona's existing
"always record at least one observation" rule and rephrase it to reference the
sink, preserving its intent:

```markdown
1. **Always record observations.** If `insights.jsonl` contains no entries with
   your agent value (or the file is absent) at report time, record a single
   observation with type `{NOTHING_FOUND_TYPE}` noting that the material you
   touched is clean and consistent. This confirms you actively looked.
```

**Step 3 — Amend the report workflow step.** Change the step that writes the
persona's report so the insight section is explicitly compiled from the sink,
e.g. for the Developer:

> Create or overwrite `synthesis.md` … compiling Code Insights from your entries
> in `insights.jsonl` per Incremental Capture, noting cross-agent corroboration
> where present.

**Step 4 — Leave type vocabularies persona-specific.** Do not unify observation
types across personas. Each persona keeps (or gains) its own vocabulary suited to
its lens; the shared file only standardizes the line format and the agent tag.

**Step 5 — Do not add lifecycle duties.** No persona creates the file ahead of
time (first append creates it), rotates it, or cleans it up. Archival is handled
by the existing archiver flow, which takes the plan folder wholesale.

## Curator Verification Checklist

After modifying each persona, verify:

- [ ] Incremental Capture subsection present, with sink path, the flat JSONL
      schema including the correct `agent` value, and append-only rule.
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
- [ ] The persona still reads correctly top-to-bottom; the addition did not
      duplicate rules already stated elsewhere in the persona.
