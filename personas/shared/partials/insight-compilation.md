### Compiling from the Insight Sink

When writing your report, read `insights.jsonl` from the resolved sink path and filter to entries where `agent` equals `{{insight_agent}}`. Compile {{insight_report_target}} from these entries — do not write from recall.

**Curation rules:**

- Deduplicate your own repeats, refine wording, and confirm priorities.
- Entries from other agents are read-only context: never modify, remove, or re-report them — but note corroboration where your entry overlaps (e.g., "also flagged by QA").
- Consume leniently: treat any line that fails to parse as a free-text observation and salvage its content. Never silently discard unparseable lines.

**Forcing function:** If your `{{insight_agent}}` entries are absent or the file does not exist, record a single `improvement` observation confirming that the material you touched was clean. This proves you actively looked — an empty section is not acceptable.
