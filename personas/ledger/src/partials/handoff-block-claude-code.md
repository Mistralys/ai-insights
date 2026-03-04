**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, inspect the `handoff_status` key already embedded in that response — **use it directly** instead of calling `ledger_get_handoff_status` separately. If `handoff_status` is absent or a `handoff_status_error` key is present, fall back to calling `ledger_get_handoff_status` with `current_agent: "{{role}}"`. The response JSON will contain one of two shapes — act accordingly:

   - **`auto_handoff` present** — Invoke the `Task` tool immediately. Derive the CC sub-agent name from `auto_handoff.agent_name` using this rule: strip the version suffix (e.g. `v3.5.0`), trim, lowercase, replace ` - ` with `-`, replace remaining spaces with `-`. Examples: `"3 - Developer v3.5.0"` → `3-developer`, `"2 - Project Manager v2.0.0"` → `2-project-manager`.
     - `description`: the derived CC sub-agent name (e.g. `3-developer`)
     - `prompt`: the value of `auto_handoff.prompt`

   - **`auto_handoff` absent** — End your turn by printing the handoff block exactly as returned (do not fill in your own values):
     ```
     CURRENT AGENT: <current_agent from response>
     NEXT AGENT: <next_agent from response>
     STATUS: <status from response>
     ```
