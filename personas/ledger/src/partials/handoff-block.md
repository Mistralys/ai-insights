**Handoff:** After completing your pipeline, call `ledger_get_handoff_status` with `current_agent: "{{role}}"`. The response JSON will contain one of two shapes — act accordingly:

   - **`auto_handoff` present** — Invoke `runSubagent` immediately:
     - `description`: the value of `auto_handoff.agent_name`
     - `prompt`: the value of `auto_handoff.prompt`

   - **`auto_handoff` absent** — End your turn by printing the handoff block exactly as returned (do not fill in your own values):
     ```
     CURRENT AGENT: <current_agent from response>
     NEXT AGENT: <next_agent from response>
     STATUS: <status from response>
     ```
