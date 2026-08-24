### Compiling from the Insight Sink

When writing the report, read every entry in `insights.jsonl` from the resolved sink path. The aim is to compile {{insight_report_target}} from these entries.

**Curation rules:**

- Deduplicate across agents: when multiple agents recorded the same finding, treat the corroboration as a priority signal — elevate the merged entry's priority accordingly, collapse it into a single entry, and note the corroboration (e.g., "also flagged by QA").
- Refine wording and confirm priorities for the remaining entries.
{{#if insight_consumer_only}}
- Group entries by `agent` first, then by priority within each group.
{{else}}
- Surface high-priority findings first; within the same priority, group by type.
{{/if}}
- Attribute an entry to the agent that recorded it whenever the origin adds weight or context to the finding.

{{#if insight_consumer_only}}
**Sink state handling:** This agent is a consumer-only compiler — it never writes to the sink, so it has no `session-start` marker of its own. Check each contributing agent's marker individually: if an agent that participated in this project has no `session-start` marker, note that its insight capture did not run rather than implying it found nothing.
{{else}}
**Sink state handling:** Use the `{{insight_agent}}` `session-start` marker to distinguish the sink states below — reporting a skipped duty as a clean result destroys the sidecar's value.

| What the sink contains | What it means | What to report |
|---|---|---|
| A `{{insight_agent}}` marker, plus entries from any agent | Capture ran and produced material | Every entry, curated per the rules above |
| A `{{insight_agent}}` marker, and no observations from any agent | Capture was live and genuinely found nothing | A single `improvement` observation confirming the material covered was clean |
| No `{{insight_agent}}` marker at all, or the file is missing | Capture never ran — the duty was skipped this session | Say so explicitly: record a single `improvement` observation stating that incremental capture did not run, so this report's insights are incomplete. Still compile whatever other agents contributed. |
{{/if}}

#### Constraints

- **No silent data loss.** Never silently discard unparseable lines — treat them as free-text observations and salvage their content.
- **No back-filling from memory.** When capture did not run (no `{{insight_agent}}` marker), report the gap honestly. Do not reconstruct observations from recall — back-filled insights omit everything that was only salient in the moment, which is precisely what the sink exists to preserve.
- **No empty sections.** Every compilation produces at least one observation — either curated findings or an honest gap note per the forcing function table.
