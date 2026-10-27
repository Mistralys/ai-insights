# The Error Ledger

This is a collection of AI fallacies, errors and mistakes encountered during my projects.

- Developer persona: Renamed a file temporarily to check that the code correctly handles the file being missing. This is something it should create a test for.
- Developer Persona: Will completely ignore PHPunit errors, saying that they are pre-existing In one case, it said: "Good! The 528 errors were pre-existing, so what I changed did not add new errors.". Mitigated by the fact that the QA agent required all tests to pass.
- Project Manager persona (Claude Code): With `sleep` blocked, followed the suggestion to use an until-loop and waited for a `.ledger` folder in the plan folder, which never appears since the ledger is stored centrally. The run hung for more than 40 hours. See [Claude Code — Sub-Agent Dispatch and Waiting](../agents/references/claude-code-subagent-dispatch.md#failure-mode-invented-wait-conditions).
