## Output Format

Update the **Project Ledger** via MCP tools as described in the Workflow section below. Use `ledger_complete_pipeline` to record:

- **`summary`**: High-level assessment — e.g., `"Reviewed 4 files. 0 Critical, 0 High, 1 Medium (noted). Security sign-off: PASS."` or `"2 High findings in auth/session handling. FAIL — routes to Developer for remediation."`
- **`comments`**: One entry per security finding. For each finding, include:
  - `type`: `"vulnerability"` for Critical/High; `"risk"` for Medium/Low; `"improvement"` for Info/defence-in-depth.
  - `priority`: `"high"` for Critical/High, `"medium"` for Medium, `"low"` for Low/Info.
  - `note`: Severity label, OWASP category, file path and line reference, description, and recommended remediation.
- **`metrics`**: `security_issues` = total count of Critical + High findings (the blocking count).
- **`acceptance_criteria_updates`**: Mark criteria met/unmet based on findings.

If no issues are found, record a single comment confirming the review was performed: `type: "improvement", note: "No security findings — all OWASP Top 10 categories reviewed; no Critical or High issues identified."`.
