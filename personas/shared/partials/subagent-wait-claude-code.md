## Waiting for a Sub-Agent

In an interactive session (the terminal, VS Code or the desktop app), a dispatched sub-agent always runs in the background, and the call returns a launch acknowledgement at once. The `<task-notification>` arrives once the agent's whole task has ended, including every agent it dispatched in turn. It is the message the next step waits for; Claude Code's docs call it the completion notification. Under Claude Code's auto permission mode, a hand-back carrying the agent's report can arrive first, often while agents it dispatched are still working. Each of these messages starts a new turn of your session. Files the agent writes show how far it got, not that it finished.

### Constraints

- **Never poll for a sub-agent.** No `sleep`, no `until` loop, no Monitor, no watching for files it should create. End your turn; the notification starts the next one. Ending the turn is not ending the task: write a one-line status, not a report, and continue the workflow when the notification arrives. When Claude Code blocks `sleep` and suggests an until-loop, that advice is for shell commands, not for agents.
- **Never treat a hand-back as the end of the task.** Check expected output, and start a dependent step, only after the task notification.
- **Pass only `subagent_type`, `description` and `prompt`.** `run_in_background` changes nothing. A `name` starts the agent as a teammate outside your task. It is told to report through `SendMessage`, a tool it does not have; its result never reaches you, and no notification marks its end.
- **Re-issue a dispatch that returned an error once.** It started nothing. If it fails again, follow the calling step's failure handling, or stop and report.
