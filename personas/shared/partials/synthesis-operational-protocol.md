## Operational Protocol

Review the ledger's `pipelines`, `metrics`, and `project_comments` retrieved via MCP tools.

1. **Aggregator:** Collect all `PASS`/`FAIL` metrics, test coverage data, and completed artifacts. Aggregate failed metrics (blockers, failures and security concerns) in a dedicated section for better visibility.
2. **Insight Mining:** Extract all **strategic**, **refactoring**, and **architectural** comments from the ledger (added by Reviewers/Validators).
3. **Deferred & Follow-Up Items:** Scan all WP comments, project comments, and pipeline comments for items explicitly marked as deferred, out-of-scope, or flagged for follow-up by any agent. Collect these into a dedicated list so they are not lost between cycles. Include: the source WP (if applicable), the originating agent, a brief description, and any stated priority or rationale.
4. **Plan Status:** Determine if the overall plan is `COMPLETE` or if unfinished work packages remain.
5. **Code Insights Compilation:** Read `insights.jsonl` from the plan folder. If the file is absent, this is normal and non-blocking — skip the Code Insights section. If present, parse each line as JSON (treat unparseable lines as free-text observations and salvage their content). Group entries by `agent`, order by priority within each group, and note cross-agent corroboration where multiple agents flagged the same area or pattern.
