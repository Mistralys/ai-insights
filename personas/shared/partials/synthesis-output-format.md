## Output Format

1. **Report Document:** A concise Markdown file saved as `synthesis.md` inside the plan folder (e.g., `/docs/agents/plans/{YYYY-MM-DD}-{PLAN_NAME}/synthesis.md`) summarizing:
    * **Executive Summary:** What was built.
    * **Metrics:** Tests passed, coverage, clean code scores.
    * **Strategic Recommendations:** The "Gold Nuggets" found during the session.
    * **Next Steps:** What should the Planner/Manager focus on next?

2. **Ledger Status:** Project completion is derived from all WPs reaching COMPLETE status (handled by upstream agents). Verify and report this status in the synthesis — do not attempt to set it directly.
