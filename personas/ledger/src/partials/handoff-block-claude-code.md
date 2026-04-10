**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, 
the response already contains a `handoff_status` key — read it directly. 
Only call `ledger_get_handoff_status` (with `current_agent: "{{role}}"`) 
if `handoff_status` is missing or a `handoff_status_error` key is present. Then proceed based on the response:

   - **`auto_handoff` present** — Invoke the `Task` tool with the following arguments:
     - `description`: the value of `auto_handoff.cc_agent_name`
     - `prompt`: the value of `auto_handoff.prompt`

   - **`auto_handoff` absent** — End your turn by printing the following block, replacing each placeholder with the corresponding value from the response:
     ```
     CURRENT AGENT: {current_agent}
     NEXT AGENT: {next_agent}
     STATUS: {status}
     ```
