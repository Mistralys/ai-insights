### Compiling from the Insight Sink

When writing the report, read every entry in `insights.jsonl` from the resolved sink path. The aim is to compile {{insight_report_target}} from these entries.

**Curation rules:**

- Deduplicate across agents: when multiple agents recorded the same finding, treat the corroboration as a priority signal — elevate the merged entry's priority accordingly, collapse it into a single entry, and note the corroboration (e.g., "also flagged by QA").
- Refine wording and confirm priorities for the remaining entries.
{{#if insight_consumer_only}}
- Group entries by `agent` first, then by priority within each group.
{{else}}
- Split the curated entries into two groups by type: `decision` entries form **Implementation Decisions**; every other type forms **Follow-Up Items**. Within each group, surface high-priority entries first, then group by type.
- Render each group under its own subsection heading, Implementation Decisions before Follow-Up Items, and omit a group's heading entirely when it has nothing to show — never print a heading over an empty group.
{{/if}}
- Attribute an entry to the agent that recorded it whenever the origin adds weight or context to the finding.

**Sink state handling:**
{{#if insight_consumer_only}}
This agent is a consumer-only compiler — it never writes to the sink, so it has no `session-start` marker of its own. Check each contributing agent's marker individually: if an agent that participated in this project has no `session-start` marker, note that its insight capture did not run rather than implying it found nothing.
{{else}}
Use the `{{insight_agent}}` `session-start` marker to distinguish the sink states below — reporting a skipped duty as a clean result destroys the sidecar's value.

| What the sink contains | What it means | What to report |
|---|---|---|
| A `{{insight_agent}}` marker, plus entries from any agent | Capture ran and produced material | Curate into **Implementation Decisions** and **Follow-Up Items** per the rules above, omitting whichever group is empty |
| A `{{insight_agent}}` marker, and no observations from any agent | Capture was live and genuinely found nothing | A single confirming line stating the material covered was clean — no subsections, no fabricated entry |
| No `{{insight_agent}}` marker at all, or the file is missing | Capture never ran — the duty was skipped this session | Say so explicitly in a single line: incremental capture did not run, so these insights are incomplete. Still curate into the two groups whatever other agents contributed. |
{{/if}}

#### Constraints

- **No silent data loss.** Never silently discard unparseable lines — treat them as free-text observations and salvage their content.
- **No back-filling from memory.** When capture did not run (no `{{insight_agent}}` marker), report the gap honestly. Do not reconstruct observations from recall — back-filled insights omit everything that was only salient in the moment, which is precisely what the sink exists to preserve.
- **No empty sections.** Every compilation produces at least one observation — either curated findings or an honest gap note per the forcing function table.
- **No empty subsection headings.** Print **Implementation Decisions** or **Follow-Up Items** only when the group has at least one entry.
