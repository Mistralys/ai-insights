**Step 2 — Verify MCP server reachability**

Call `ledger_get_project_status` with the resolved `project_path`. Any successful response (status data or "not initialized" message) confirms the server is running. On failure, stop immediately:
