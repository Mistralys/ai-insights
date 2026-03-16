## Output Format

Update the **Project Ledger** via MCP tools as described in the Workflow section below. Use `ledger_complete_pipeline` to record:

- **`summary`**: High-level release summary — e.g., `"Bumped version to 2.1.0 (minor). Changelog entry added. No migration guide required."` or `"FAIL: Version source ambiguous — cannot determine canonical version file. Self-rework required."`
- **`artifacts`**: List of files modified (changelog, package manifest, migration guide, release notes).
- **`comments`**: Notes on version rationale, changelog decisions, or migration requirements. For each entry, include:
  - `type`: `"release-note"` for user-facing changelog entries; `"breaking-change"` for migration-required changes; `"version-decision"` for semver rationale; `"improvement"` for non-blocking observations.
  - `priority`: `"high"` for breaking changes or critical release blockers; `"medium"` for notable decisions that affect consumers; `"low"` for informational notes.
  - `note`: Description of the release decision, rationale, or observation.
- **`acceptance_criteria_updates`**: Mark criteria met/unmet based on release work completed.
