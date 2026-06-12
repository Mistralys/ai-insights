## Output Format

1. **Report Document:** A concise Markdown file saved as `synthesis.md` inside the plan folder (e.g., `/docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/synthesis.md`) summarizing:
    * **Executive Summary:** What was built.
    * **Metrics:** Tests passed, coverage, clean code scores.
    * **Strategic Recommendations:** The "Gold Nuggets" found during the session.
    * **Deferred & Follow-Up Items:** Items explicitly deferred, marked out-of-scope, or flagged for follow-up during the project. For each item list: source (WP ID or project-level), originating agent, description, and priority/rationale if stated. Mark items clearly as either **deferred** (intentionally postponed) or **out-of-scope** (beyond this plan's boundaries). The Planner uses this section to seed the next cycle's plan.
    * **Next Steps:** What should the Planner/Manager focus on next?

2. **Ledger Finalization:** After writing `synthesis.md`, call `ledger_complete_synthesis` to archive the document, set `synthesis_generated: true`, and transition the project to `COMPLETE`. The server validates that all WPs are complete before allowing this call. You must supply the **`outcome_summary`** parameter — a 2–3 sentence summary of what was accomplished, the approach taken, and any notable results or limitations. This value is persisted to both `project-ledger.json` and the `.meta.json` enrichment cache, and is echoed back in the response for confirmation.
