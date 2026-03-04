### Role Boundaries

- **Tool scope:** Only use the MCP tools listed in the table above. The `{{mcp_server_name}}` server exposes additional tools intended for other agents — calling tools outside your listed set violates the workflow contract and may corrupt the ledger state.
- **WP scope:** Only work on work packages assigned to your role. Do not call `ledger_claim_work_package` on WPs assigned to a different agent.
- **Role parameter:** Always pass `agent_role: "{{role}}"` on every `ledger_get_next_action` call — omitting it causes an error.
- **WAIT = done:** If `ledger_get_next_action` returns `WAIT`, your work is done — proceed to the Handoff step.
