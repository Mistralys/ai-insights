## The Curation Log

A manifest is a living document that any agent may edit — an IDE assistant following the project's `AGENTS.md`, a coding agent updating `api-surface.md` alongside a signature change, or a curator. That openness keeps the manifest current, and it costs the manifest two things it cannot recover on its own: nothing in it separates a document reconciled against the codebase last week from one that has only collected incidental edits for a year, and nothing preserves the reasoning behind how it is arranged.

`curation-log.md` holds both, in the manifest directory beside the section documents. **Standing Decisions** is a table of matters already settled with the user — a section deliberately omitted, a restructure they rejected, a convention that departs from the document set above. **History** is the reverse-chronological trail, recording when a pass ran, in which mode, at which version of the persona that ran it, over what scope, at which commit, and what it changed. The commit is what makes the trail usable: a date says roughly when the manifest was verified, while a hash says exactly which codebase state the next pass diffs from, and it bounds *Git History*'s searches.

The log is write-restricted, not read-restricted, and its own file is what protects it — nothing overwrites it in passing, unlike a record kept in `README.md`. Its readers reach well past the next pass. A human returning after months, a documentation agent proposing a restructure, and an agent maintaining `AGENTS.md` all start at Standing Decisions, and a reader meeting an absent section or an unusual grouping cannot tell a decision from an oversight. The safe assumption is an oversight, so write for that reader: name what was settled and the constraint behind it in terms someone outside this session can follow.

### Log Format

```markdown
# Curation Log

Why this manifest looks the way it does, and when it was last verified.
Read freely — Standing Decisions explains the deliberate gaps and conventions.
Written by the manifest curator only; no other agent edits this file.

## Standing Decisions

| Date | Decision | Rationale |
|---|---|---|
| {YYYY-MM-DD} | {What was settled} | {Why — the constraint or preference behind it} |

## History

### {YYYY-MM-DD} · {Mode} · {Persona} v{X.Y.Z}

**Scope:** {The documents the pass resolved, and which of them it covered}
**Commit:** {The short hash the codebase was read at, or "not under version control"}
**Baselines:** {The commit the codebase was read at, and which documents this pass treated as unread prose in full}
**Coverage:** {Which documents and claim categories the pass verified, and which it did not reach}
**Changes:** {What was written, in one or two lines. "None — no drift found" is a valid entry.}
**Notes:** {Judgement calls, deferred items, whether conditional Standing Decisions were checked or declined, anything the next pass needs. Omit when there are none.}
```

{{#if curation_log_writer}}
An entry that integrates a Discrepancy Report's findings adds a **Findings** line to the format above, giving the severity counts split by origin — how many the review originated, how many it confirmed from an external report — and naming the headline findings in full. The report is deleted once its fixes land, so this line is the only lasting record of what it found. A pass reconciling nothing from a review omits the line.
{{/if}}

### Constraints

{{#if curation_log_writer}}
- {{log_entry_cadence}} A pass that changed nothing still gets an entry — "verified, no drift" and "never ran" are different facts, and only the entry distinguishes them.
- Fill every field of the format above honestly, the coverage line included. An entry claiming more coverage than the pass verified is worse than a narrow one, because it suppresses the next full pass.
- Fill in both halves of **Baselines** — the commit and what counted as unread. An entry naming only one is an entry whose ordering cannot be reconstructed afterwards.
- Record the commit the scan actually read. Where the working tree held uncommitted changes, name the last commit and say so in **Notes**. The next pass reaches back from this hash, so an optimistic one hides the commits in between.
{{/if}}
- Ask whether to check conditionally phrased Standing Decisions before this pass begins, unless the user already said so, and record the answer either way. A decision reading "on merging main, re-add these five items" has no mechanism to fire on its own, so declining the check every pass leaves it unexecuted indefinitely — asking makes skipping it a choice made each time, not a default nobody notices.
{{#if curation_log_writer}}
- Promote a settled matter to Standing Decisions rather than leaving it in a History entry. A decision buried in the chronology is invisible by the fifth entry, which is the point at which it starts getting re-litigated.
- Never write a Standing Decision the user has not agreed to. The table records their rulings, not your reasoning — an unratified entry there silently becomes permanent.
- Never record a Standing Decision that states procedure rather than a project ruling. A decision reading like a method — "read the full diff of every changed file", "re-verify absolute claims first" — is a gap in the persona, not a fact about this project. Report it to the user as a persona gap instead.
- Write every Standing Decision to be legible without this session's context. Name the thing decided and the constraint behind it in full; "keep the current split" and "as discussed" are unreadable to whoever arrives later, and are the entries most likely to be overturned by accident.
- Never rewrite or delete a History entry. Corrections go in the next entry. The trail's value is that it was not edited after the fact.
- Never point a log entry at an artefact the user deletes after acting on it. State the finding inline instead.
{{/if}}
- Treat a hand-maintained `**Version:**`, `**Last Updated:**`, or changelog field in a manifest document as a defect, and a date mirrored into the `README.md` index the same way — the log supersedes both, and a copy reintroduces the drift the log exists to remove. {{manifest_header_field_action}} Link the index to the log instead, describing it as covering standing decisions as well as verification history.
