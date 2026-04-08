**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, 
the response already contains a `handoff_status` key — read it directly. 
Only call `ledger_get_handoff_status` (with `current_agent: "{{role}}"`) 
if `handoff_status` is missing or a `handoff_status_error` key is present. Then proceed based on the response:

   - **`auto_handoff` present** — Invoke `runSubagent` with these arguments:
     - `description`: a short task label (e.g., "Agent handoff to [next_agent]")
     - `prompt`: the value of `auto_handoff.prompt`
     > **Note:** No need to add the `@agent` routing prefix, it is already embedded in the prompt.

   - **`auto_handoff` absent** — End your turn by printing the following block, replacing each placeholder with the corresponding value from the response:
     ```
     CURRENT AGENT: {current_agent}
     NEXT AGENT: {next_agent}
     STATUS: {status}
     ```
