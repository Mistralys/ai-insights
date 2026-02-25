**Handoff (mandatory):** Call `ledger_get_handoff_status` with `current_agent: "{{role}}"`. **You must call this tool before ending your turn** — it is the only mechanism that triggers the next agent in the workflow. The response JSON will contain one of two shapes — act accordingly:

   - **`auto_handoff` present** — Invoke `runSubagent` immediately:
     - `agentName`: the value of `auto_handoff.agent_name`
     - `description`: a short task label (e.g., "Agent handoff")
     - `prompt`: the value of `auto_handoff.prompt`

   - **`auto_handoff` absent** — End your turn by printing the handoff block exactly as returned (do not fill in your own values):
     ```
     CURRENT AGENT: <current_agent from response>
     NEXT AGENT: <next_agent from response>
     STATUS: <status from response>
     ```
