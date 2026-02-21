**Step 1 — Verify MCP server reachability**

Call `ledger_get_project_status` with the target `project_path`. A "Project not initialized" message confirms the server is running. On failure, stop immediately:
