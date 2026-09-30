**Handoff (mandatory):** When `ledger_get_next_action` returns `action: WAIT`, 
the response already contains a `handoff_status` key — read it directly. 
Only call `ledger_get_handoff_status` (with `current_agent: "{{role}}"`) 
if `handoff_status` is missing or a `handoff_status_error` key is present. Then proceed based on the response:

   - **`auto_handoff` present** — Invoke the `Task` tool with the following arguments:
     - `subagent_type`: the value of `auto_handoff.cc_agent_name`
     - `description`: a short task label (e.g., "Agent handoff to [next_agent]")
     - `prompt`: the value of `auto_handoff.prompt`, exactly as received
     > **Note:** `subagent_type` is what selects the agent. Without it, Claude Code starts a general-purpose agent that has no persona. The prompt is passed on unchanged: the successor loads its own persona and reads its assignment from the ledger. The `@` prefix at the start of the prompt is a VS Code routing directive and stays in place.

   - **`auto_handoff` absent** — End your turn by printing the following block, replacing each placeholder with the corresponding value from the response:
     ```
     CURRENT AGENT: {current_agent}
     NEXT AGENT: {next_agent}
     STATUS: {status}
     ```
