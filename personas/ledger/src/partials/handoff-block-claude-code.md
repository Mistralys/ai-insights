**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, 
the response already contains a `handoff_status` key — read it directly. 
Only call `ledger_get_handoff_status` (with `current_agent: "{{role}}"`) 
if `handoff_status` is missing or a `handoff_status_error` key is present. Then proceed based on the response:

   - **`auto_handoff` present** — Invoke the `Task` tool immediately. Derive the sub-agent name from `auto_handoff.agent_name` using this rule: strip the version suffix (e.g. `v3.5.0`), trim, lowercase, replace ` - ` with `-`, replace remaining spaces with `-`. Examples: `"3 - Developer v3.5.0"` → `3-developer`, `"2 - Project Manager v2.0.0"` → `2-project-manager`. These are the expected arguments:
     - `description`: the sub-agent name (e.g. `3-developer`)
     - `prompt`: the value of `auto_handoff.prompt`

   - **`auto_handoff` absent** — End your turn by printing the following block, replacing each placeholder with the corresponding value from the response:
     ```
     CURRENT AGENT: {current_agent}
     NEXT AGENT: {next_agent}
     STATUS: {status}
     ```
