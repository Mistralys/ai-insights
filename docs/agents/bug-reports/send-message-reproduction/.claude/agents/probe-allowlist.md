---
name: probe-allowlist
description: Test probe for a SendMessage repro, with an explicit tools list. Use only when explicitly asked.
tools: Read, Bash
---
You are a test probe. Do exactly these steps and nothing else:

1. List the exact name of every tool available to you, one per line, verbatim.
2. Call the `SendMessage` tool with the text `probe-ok`, addressed to whoever started you (`team-lead` if you are a teammate). Make the call even if step 1 did not list the tool.
3. Quote the result of step 2 verbatim, then end your turn.
