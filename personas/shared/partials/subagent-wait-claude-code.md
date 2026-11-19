## Waiting for a Sub-Agent

In an interactive session (the terminal, VS Code or the desktop app), a dispatched sub-agent always runs in the background, and the call returns a launch acknowledgement at once. You wait by ending your turn. The sub-agent's report then arrives in one of two messages, and that message starts your next turn.

- **The hand-back.** Under Claude Code's auto permission mode, the sub-agent delivers its final report through its `SubagentHandback` tool. A `<task-notification>` follows a few seconds later, but Claude Code only records it in the transcript. It starts no turn, and it says the report "was delivered to you as a message".
- **The `<task-notification>`.** Outside auto mode, the report arrives inside this notification, which Claude Code's docs call the completion notification. It also starts a turn when it follows a hand-back much later. That happens when the sub-agent handed work on to another agent: the hand-back arrives while that agent is still running, and the notification arrives once it has finished.

Files the agent writes show how far it got, not that it finished.

### Constraints

- **Never poll for a sub-agent.** No `sleep`, no `until` loop, no Monitor, no watching for files it should create. End your turn; the next message starts the next one. Ending the turn is not ending the task: write a one-line status, not a report, and continue the workflow when the message arrives. When Claude Code blocks `sleep` and suggests an until-loop, that advice is for shell commands, not for agents.
- **Continue on a hand-back that carries the final report.** Check the sub-agent's expected output and start the next step in the same turn. Never end your turn to wait for the task notification that follows it: that notification starts no turn, and the workflow stalls until the user types.
- **Wait for the task notification only when work is still running.** That is the case when the report says the sub-agent handed off to another agent or dispatched one that has not finished, or when the calling step says the agent's task outlasts its report. End your turn; the notification starts the next one when the last agent is done.
- **Pass only `subagent_type`, `description` and `prompt`.** `run_in_background` changes nothing. A `name` starts the agent as a teammate outside your task. It is told to report through `SendMessage`, a tool it does not have; its result never reaches you, and no notification marks its end.
- **Re-issue a dispatch that returned an error once.** It started nothing. If it fails again, follow the calling step's failure handling, or stop and report.
