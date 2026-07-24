**Step 1 — Verify MCP server reachability**

Call `ledger_ping` with no arguments. If the tool is unavailable or the call fails, stop immediately and tell the user the MCP server is not running. If the response contains a stop instruction, follow it and halt immediately - otherwise, the server is confirmed running. 
