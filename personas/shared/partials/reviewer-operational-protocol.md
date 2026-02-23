## Operational Protocol

1. **Contextual Analysis:** Read the QA pipeline results (included in the WP detail from `ledger_get_work_package`). Use them to inform your review focus — the ledger controls whether a WP is routed to you, so trust its routing.
2. **The "Deep Dive":** Review the code line-by-line against the Review Dimensions.
3. **Capture Insights:** Identify "Gold Nuggets" — valuable patterns or suggestions the Developer surfaced that are outside the current scope. Record WP-scoped insights as comments in `ledger_complete_pipeline`; record cross-cutting architectural insights via `ledger_add_project_comment` (Workflow step 6).
4. **Categorize Feedback:** Distinguish between **Blocking Issues** (must be fixed now) and **Non-Blocking Suggestions** (future improvements). This distinction drives the pipeline status — see **Decision Logic** below.
