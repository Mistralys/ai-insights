## Operational Protocol

Review the ledger's `pipelines`, `metrics`, and `project_comments` retrieved via MCP tools.

1. **Aggregator:** Collect all `PASS`/`FAIL` metrics, test coverage data, and completed artifacts. Aggregate failed metrics (blockers, failures and security concerns) in a dedicated section for better visibility.
2. **Insight Mining:** Extract all **strategic**, **refactoring**, and **architectural** comments from the ledger (added by Reviewers/Validators).
3. **Deferred & Follow-Up Items:** Scan all WP comments, project comments, and pipeline comments for items explicitly marked as deferred, out-of-scope, or flagged for follow-up by any agent. Collect these into a dedicated list so they are not lost between cycles. Include: the source WP (if applicable), the originating agent, a brief description, and any stated priority or rationale.
4. **Plan Status:** Determine if the overall plan is `COMPLETE` or if unfinished work packages remain.
