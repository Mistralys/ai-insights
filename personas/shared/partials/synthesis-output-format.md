## Output Format

1. **Report Document:** A concise Markdown file saved as `synthesis.md` inside the plan folder (e.g., `/docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/synthesis.md`) summarizing:
    * **Executive Summary:** What was built.
    * **Metrics:** Tests passed, coverage, clean code scores.
    * **Strategic Recommendations:** The "Gold Nuggets" found during the session.
    * **Next Steps:** What should the Planner/Manager focus on next?

2. **Ledger Finalization:** After writing `synthesis.md`, call `ledger_complete_synthesis` to archive the document, set `synthesis_generated: true`, and transition the project to `COMPLETE`. The server validates that all WPs are complete before allowing this call.
