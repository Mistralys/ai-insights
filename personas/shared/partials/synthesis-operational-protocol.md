## Operational Protocol

Review the ledger's `pipelines`, `metrics`, and `project_comments` retrieved via MCP tools.

1. **Aggregator:** Collect all `PASS`/`FAIL` metrics, test coverage data, and completed artifacts. Aggregate failed metrics (blockers, failures and security concerns) in a dedicated section for better visibility.
2. **Ledger Insight Mining:** Extract all **strategic**, **refactoring**, and **architectural** comments from the ledger via MCP tools (added by Reviewers/Validators). Note: This is distinct from the `insights.jsonl` sidecar compiled in step 5.
3. **Deferred & Follow-Up Items:** Scan all WP comments, project comments, and pipeline comments for items explicitly marked as deferred, out-of-scope, or flagged for follow-up by any agent. Collect these into a dedicated list so they are not lost between cycles. Include: the source WP (if applicable), the originating agent, a brief description, and any stated priority or rationale.
4. **Plan Status:** Determine if the overall plan is `COMPLETE` or if unfinished work packages remain.
5. **Code Insights Compilation:** Read `insights.jsonl` from the plan folder. If the file is absent, skip the Code Insights section entirely — this is normal and non-blocking. If present, apply the curation rules in the *Compiling from the Insight Sink* section.
