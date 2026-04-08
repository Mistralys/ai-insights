You are right, a lookup table in the persona is not a good way.

Still, we need a solid, future-proof way to handle this. It's the persona builder's role to provide access to the needed metadata - an idea would be to generate a JSON-based name mapping metadata file for the ledger to read at runtime. 

This could be something like this, which repeats some of the essential information from the YAML metadata with specific naming information:

```json
[
    {
        "id": "ledger-3-dev",
        "name": "Developer",
        "version": "3.6.1",
        "visual_studio": {
            "tool_prefix": "vs",
            "file_name": "3-dev.agent.md",
            "agent_name": "3 - Developer v3.6.1"
        },
        "claude_code": {
            "tool_prefix": "cc",
            "file_name": "3-developer.md",
            "agent_name": "3-developer"
        },
        "deep_agents": {
            "tool_prefix": "da",
            "file_name": "3-developer.md",
            "agent_name": "3-developer"
        }
    }
]
```

This should be output to `/personas/name-mapping.json`.

This will enable us to add the agent names in the handoff for all target systems, namely:

- `cc_agent_name`
- `vs_agent_name`
- `da_agent_name`

In the personas, this will make it possible to tell the agent which field to use to get the name, for example in the Claude Code handoff section which can be simplified to:

```
  - **`auto_handoff` present** — Invoke the `Task` tool immediately with these parameters: 
     - `description`: The sub-agent name from `auto_handoff.cc_agent_name`.
     - `prompt`: the value of `auto_handoff.prompt`
```
