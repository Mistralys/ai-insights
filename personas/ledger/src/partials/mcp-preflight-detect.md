**Detect the active project**

Combine project detection with your first action query — call `ledger_get_next_action` with `cwd_path` (workspace root) and `agent_role: "{{role}}"`. The tool resolves the matching project from the centralized ledger. A successful response also confirms the MCP server is reachable. On failure, stop immediately:
