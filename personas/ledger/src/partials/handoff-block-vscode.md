**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, inspect the `handoff_status` key already embedded in that response — **use it directly** instead of calling `ledger_get_handoff_status` separately. If `handoff_status` is absent or a `handoff_status_error` key is present, fall back to calling `ledger_get_handoff_status` with `current_agent: "{{role}}"`. The response JSON will contain one of two shapes — act accordingly:

   - **`auto_handoff` present** — Invoke `runSubagent` immediately:
     - `description`: a short task label (e.g., "Agent handoff to [next_agent]")
     - `prompt`: the value of `auto_handoff.prompt`
     > **Note:** The `@agent` routing prefix is already embedded in the prompt by the MCP server — do not add your own.

   - **`auto_handoff` absent** — End your turn by printing the handoff block exactly as returned (do not fill in your own values):
     ```
     CURRENT AGENT: <current_agent from response>
     NEXT AGENT: <next_agent from response>
     STATUS: <status from response>
     ```
