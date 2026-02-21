**Step 1 — Verify MCP server reachability**

Derive `project_path` from the plan document currently open in the editor — its parent folder is the plan directory. Call `ledger_get_project_status` with this path. A "Project not initialized" message confirms the server is running. On failure, stop immediately:
