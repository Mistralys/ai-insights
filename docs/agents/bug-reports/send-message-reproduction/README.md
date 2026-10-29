# SendMessage teammate repro

Controlled test for Finding 4 of [the bug report](../2026-10-26-claude-code-subagent-dispatch-and-waiting.md).

Four cases, one fresh session started as `claude --agent lead`. Settings as in the bug report: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

| Case | Spawned by | Agent definition | Question it answers |
|---|---|---|---|
| A | main session | `tools: Read, Bash` | Does the allowlist strip SendMessage even without nesting? |
| B | a sub-agent (`relay`) | `tools: Read, Bash` | The pattern seen in the logs |
| C | main session | no `tools:` line | Control: is SendMessage added at all? |
| D | a sub-agent (`relay`) | no `tools:` line | Does nesting alone remove it? |

## Run

    cp -R docs/agents/bug-reports/send-message-reproduction ~/sendmessage-repro
    cd ~/sendmessage-repro && claude --agent lead

Copy the folder out first: a session started inside this repository loads its CLAUDE.md and AGENTS.md files into every agent, which the repro must not have.

The session runs under `--agent` because every logged launch did: `--agent` replaces the default system prompt, so a plain session would change a second variable. The `lead` agent is deliberately minimal. A real persona's own dispatch rules would compete with the test prompts, and maintainers cannot reproduce it. Optionally, repeat the four cases in a plain `claude` session afterwards; a different result there is a finding of its own.

Paste the prompts one at a time, waiting for each to finish:

    A: Use the Agent tool with subagent_type "probe-allowlist", name "probe-a", description "probe A", prompt "Run your probe steps." Then end your turn and wait for its notification. Report what it said verbatim.
    B: Use the Agent tool WITHOUT a name, subagent_type "relay", description "relay B", prompt "Probe agent type: probe-allowlist. Teammate name: probe-b." Then end your turn and wait. Report verbatim.
    C: Use the Agent tool with subagent_type "probe-open", name "probe-c", description "probe C", prompt "Run your probe steps." Then end your turn and wait for its notification. Report what it said verbatim.
    D: Use the Agent tool WITHOUT a name, subagent_type "relay", description "relay D", prompt "Probe agent type: probe-open. Teammate name: probe-d." Then end your turn and wait. Report verbatim.

## Cases E and F — does the lead's tool list cap the teammates?

Run 1 (2026-10-26) showed that probes C and D, which have no `tools:` line, received exactly the lead's tools (`Agent, Read, Bash`) and no `SendMessage`. Cases E and F add `SendMessage` to the lead's list and change nothing else. Start a new session:

    cd ~/sendmessage-repro && claude --agent lead-sm

and paste:

    E: Use the Agent tool with subagent_type "probe-allowlist", name "probe-e", description "probe E", prompt "Run your probe steps." Then end your turn and wait for its notification. Report what it said verbatim.

Then, in the same session:

    F: Use the Agent tool with subagent_type "probe-open", name "probe-f", description "probe F", prompt "Run your probe steps." Then end your turn and wait for its notification. Report what it said verbatim.

If probe E can call `SendMessage`, the lead's `tools:` list is what removes it from teammates. Probe F has no `tools:` line, so it should then list `SendMessage` among the tools it inherits.

## Run 3 — confirm effect 3, and the plain-session path

Three questions are left after runs 1 and 2. Start **one new session per case**, from `~/send-message-reproduction`, and add `--debug` to each start command so the request logs can be attached to an upstream issue.

| Case | Start the session with | Question |
|---|---|---|
| B2 | `claude --agent lead --debug` | Does effect 3 (the nested probe's result reaches no one) repeat? Run 1 had one sample per case. |
| H1 | `claude --agent lead-sm --debug` | Does effect 3 persist when the lead holds `SendMessage`? |
| H2 | `claude --agent lead-sm --debug` | The same, for a probe with no `tools:` line. |
| G | `claude --debug` (no `--agent`) | Does a teammate get `SendMessage` on the default path, where the main session holds every tool? |

Prompts, one per session:

    B2: Use the Agent tool WITHOUT a name, subagent_type "relay", description "relay B2", prompt "Probe agent type: probe-allowlist. Teammate name: probe-b2." Then end your turn and wait. Report verbatim.
    H1: Use the Agent tool WITHOUT a name, subagent_type "relay", description "relay H1", prompt "Probe agent type: probe-allowlist. Teammate name: probe-h1." Then end your turn and wait. Report verbatim.
    H2: Use the Agent tool WITHOUT a name, subagent_type "relay", description "relay H2", prompt "Probe agent type: probe-open. Teammate name: probe-h2." Then end your turn and wait. Report verbatim.
    G: Use the Agent tool with subagent_type "probe-allowlist", name "probe-g", description "probe G", prompt "Run your probe steps." Then end your turn and wait for its notification. Report what it said verbatim. Do nothing else.

For B2, H1 and H2, keep the session open for at least two minutes after the relay's report arrives, so a late idle notification from the probe has time to arrive.

## Evidence

The authoritative record is not the agents' replies but the files under
`~/.claude/projects/<slug of ~/sendmessage-repro>/<session>/subagents/`:

- `agent-aprobe-*.meta.json` → `taskKind` (expect `in_process_teammate`), `parentAgentId` (set for B and D), `requestNonInteractive`.
- `agent-aprobe-*.jsonl` → the `SendMessage` tool_use and its tool_result: success, or "No such tool available: SendMessage".
- The lead's own `<session>.jsonl` → whether the probe's idle notification (`"type":"idle_notification"`) arrived.

The tools each probe lists are its own report. The `--debug` logs are the independent record of what was actually sent.

Run 3's debug logs are in [`debug-logs/`](debug-logs/), one file per case (`case-{case}-{session id}.txt`). Search them for `TeammateMailbox`, `InboxPoller` and `Unknown tool SendMessage`.

## Results

Both runs (2026-10-26, Claude Code 2.1.310, auto mode) are written up in the bug report under [Controlled Test Results](../2026-10-26-claude-code-subagent-dispatch-and-waiting.md#controlled-test-results). Run 1 (cases A–D) was started inside the repository, so its CLAUDE.md and AGENTS.md were loaded; this does not affect which tools the agents had. Run 2 (cases E and F) and run 3 (cases B2, H1, H2, G, with `--debug`) were started from `~/send-message-reproduction`. In short: teammates get `SendMessage` only when the main-thread agent holds it (always true without `--agent`). A teammate spawned by a sub-agent writes its messages to the lead's mailbox, but the lead never polls it, so its result is lost.
