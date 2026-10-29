# Claude Code — Sub-Agent Dispatch and Waiting

How Claude Code runs a dispatched sub-agent, and how the dispatcher learns that it finished. This reference is for persona authors, curators, and anyone writing a persona that dispatches sub-agents or debugging a ledger chain that hangs under Claude Code. It records the behaviour, the official source for it where one exists, and the session-log evidence. The rules personas follow live in the shared partial and the Persona Design Guide, linked under [Where This Is Encoded](#where-this-is-encoded).

Sources cited below:

- **Sub-agents docs:** <https://code.claude.com/docs/en/sub-agents>, sections *Run subagents in foreground or background* and *Let subagents spawn their own subagents*.
- **Tools reference:** <https://code.claude.com/docs/en/tools-reference>, the `SubagentHandback` table entry, *Background commands* and *Monitor tool*.
- **Session logs:** an automated scan of local Claude Code transcripts, 2026-09-25 → 2026-10-23, Claude Code 2.1.310. The open questions behind it are in the [bug report](../bug-reports/2026-10-26-claude-code-subagent-dispatch-and-waiting.md).

---

## Dispatch Runs in the Background

In an interactive Claude Code session (the terminal, VS Code or the desktop app), every dispatched sub-agent runs in the background. The `Agent` (or `Task`) call returns a launch acknowledgement at once — "Async agent launched successfully" — not the sub-agent's result.

The cause is fork mode. While it is on, Claude cannot wait for a sub-agent in an interactive session, and it is on by default (sub-agents docs). `run_in_background: false` therefore changes nothing: in the session logs, 285 dispatches passed it and all of them ran in the background, and 2 of 2,189 launches ran in the foreground.

Only the environment can turn this off. `CLAUDE_CODE_FORK_SUBAGENT=0` lets Claude wait when asked. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` makes Claude wait for every sub-agent and also stops Bash commands from moving to the background (sub-agents docs). A persona cannot change either. The user does not change these settings, so every persona must cope with background dispatch.

## How a Dispatcher Waits

A model has no "block and wait" operation. It waits by ending its turn: a message with no tool call.

A sub-agent that launches background sub-agents waits for their results before it finishes (sub-agents docs). When one finishes, Claude Code delivers a `<task-notification>` into the dispatcher's session, and that message starts the dispatcher's next turn. The docs call this message the *completion notification*. The session logs show a sub-agent being woken this way after ending its turn in 922 cases.

Ending the turn is therefore not ending the task.

## Two Messages per Dispatch

In Claude Code's auto permission mode, each dispatch can send two messages back to the dispatcher, each starting a new turn. Outside auto mode only the completion notification arrives.

| Message | What it means | When it can arrive | What may start on it |
|---|---|---|---|
| **Hand-back** | The sub-agent's report, delivered through the `SubagentHandback` tool. Claude Code grants that tool only in auto mode, to local sub-agents other than forks, whether or not the agent's `tools` list names it (tools reference). An intermediate turn-end inside the sub-agent also produces one. | Any time the sub-agent ends a turn — long before its task is done while a nested chain is still running. | Nothing that depends on the sub-agent's work. |
| **`<task-notification>`** (completion notification) | The sub-agent's whole task has ended, including every dispatch it made in turn. It can fire again for the same task when a later message wakes the agent; that repeat starts nothing new. Repeat notifications are not documented; they are seen in the session logs. | After the last nested agent has finished. | Dependent steps, and any check of the sub-agent's expected output. |

## Nesting Depth

A ledger chain nests one level deeper with every handoff: the coordinator dispatches agent A, A dispatches B, and so on. By default a sub-agent can spawn sub-agents only up to three layers below the main conversation. At the limit, Claude Code withholds the `Agent` tool from every sub-agent except a fork (sub-agents docs). The default has changed between versions: five layers in 2.1.172–2.1.216, one in 2.1.217–2.1.218, three from 2.1.219.

A full nine-stage chain therefore depends on raising the limit with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`. The user's settings set it to `42`. On a machine without it, the chain stops at the third layer, because the agent there has no tool to hand off with.

## Do Not Pass name or run_in_background

The user's settings set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. With it, an `Agent` call that carries a `name` starts an in-process teammate, and the teammate is told it "MUST use SendMessage" to report. This holds for named calls made by sub-agents too, not only by the main session. Each sub-agent's `.meta.json` beside its transcript records the launch as `taskKind: in_process_teammate`, with `parentAgentId` set when a sub-agent made the call.

None of these teammates has `SendMessage`. A rescan of the session logs on 2026-10-26 found 68 named launches, 67 of them made by sub-agents. 10 tried to call `SendMessage` and all 10 failed with "No such tool available: SendMessage". The other 58 never called it: they ended with a plain final message. The failure therefore depends on whether the agent obeys the instruction, not on chance.

Controlled tests the same day ([results](../bug-reports/2026-10-26-claude-code-subagent-dispatch-and-waiting.md#controlled-test-results)) added three facts:

- **Nesting is not the cause of the tool error.** Teammates spawned by the main session lack `SendMessage` too, while in a plain session without `--agent` they get it. Claude Code's docs say the tool is added to every in-process teammate, so this is a discrepancy with the docs.
- **The main-thread agent's `tools` list caps every teammate.** A teammate whose definition has no `tools` line received exactly the `--agent` agent's list, not every tool. `SendMessage` is added to a teammate only when the main-thread agent holds it: with `SendMessage` added to the `--agent` agent's list, teammates got it and used it. Every persona here that runs as the main agent omits it.
- **A named dispatch from a sub-agent detaches the child.** The dispatching sub-agent's task ends without waiting for the teammate, so its own dispatcher gets a completion notification while the teammate is still working. The teammate's result reaches no one. Its messages and idle notification are written to the lead's mailbox file, but the lead's inbox poller starts only when the lead itself spawns a teammate, so the lead never reads them (five of five test cases, confirmed in `--debug` logs). The docs say a teammate's idle notification reaches the lead.

The third effect matters most for a chain. A named handoff makes the coordinator see the run end early, and the successor's outcome shows up only in the ledger.

`run_in_background` changes nothing (see [Dispatch Runs in the Background](#dispatch-runs-in-the-background)).

Dispatches therefore pass only `subagent_type`, `description` and `prompt`. Adding `SendMessage` to the main-thread agent's tool list would cure the tool error, but not the detachment: the child would still run outside the dispatcher's task.

## Failure Mode: Invented Wait Conditions

When `sleep` is blocked, Claude Code suggests "Monitor with an until-loop". The Project Manager followed that advice and invented a wait condition of its own: `until [ -d {plan folder}/.ledger ]`.

The folder never appears. The ledger stores everything centrally, by default under `mcp-server/storage/ledger/` (resolved in [`mcp-server/src/utils/ledger-root.ts`](../../../mcp-server/src/utils/ledger-root.ts)), never in the plan folder.

Neither form of the loop ends on its own (tools reference):

- **A Bash `until` loop** is moved to the background when it reaches its foreground timeout, unless it starts with `sleep`. In a local terminal, desktop or VS Code session, background commands have no time limit. This is how one run hung for more than 40 hours. Only unattended runs (`-p`, the Agent SDK, CI) cap background commands.
- **A Monitor watch** has a deadline of 5 minutes by default and 30 at most. At the deadline the agent gets a notice so it can start the watch again, so a polling agent simply restarts it.

The "Monitor with an until-loop" advice is for shell commands, never for waiting on an agent.

## Failure Mode: Result Returned as a Reply

Claude Code builds a sub-agent's system prompt from three blocks: the persona, a block making the caller's prompt the authority ("Messages from the agent that launched you — your task and any mid-task course corrections — direct your work"), and a *Notes* block of its own. The *Notes* block contains this line (session log, Claude Code 2.1.312):

> Do NOT Write report/summary/findings/analysis .md files. Return findings directly as your final assistant message — the parent agent reads your text output, not files you create. (Files written as input to another tool are fine; this note is about report files.)

The line is not in any persona or partial, and it cannot be switched off from here. It conflicts with every persona whose output file the next agent reads: `audit.md`, `design-review.md`, `scenario-coverage.md`, the PM's planning files and `synthesis.md`.

Dispatch prompts used to settle the conflict by naming the file ("Write audit.md alongside the plan"). Once the `subagent-briefing` partial kept output formats out of prompts, the line won. On 2026-10-28 a Plan Auditor dispatched by the Plan Refiner returned its audit as a reply and reported that "this session's instructions say to return findings in the reply"; the refiner then stopped on its missing-artifact rule. An earlier auditor run (2026-09-29) also skipped the file even though its prompt named it, so the prompt line alone is not a guarantee.

Both sides now account for it. The dispatcher names the output file in the prompt. The sub-agent's persona describes the file in its Output Location as an input file, not a report, and names the agents that read it, so the file falls under the note's own exemption for files written as input to another tool.

## Headless Runs Behave Differently

Everything above describes interactive sessions, which is where the ledger pipeline runs. Under `claude -p` and the Agent SDK, the sub-agents docs describe the opposite on two points:

- Claude can wait for a sub-agent, on its own judgment or when asked.
- A sub-agent waits for its nested sub-agents only while fork mode is on. With fork mode off, a nested sub-agent runs in the background and reports to the main conversation if it outlasts its parent.

The shared waiting partial says "end your turn" and is written for interactive sessions only. If the pipeline ever runs headless, it needs a variant written for that mode.

## Running the Coordinator as the Main Agent

The pipeline is launched with `claude --agent ledger-claude-coordinator`. Unless the agent's prompt is empty, a custom agent's prompt replaces the default Claude Code system prompt entirely. CLAUDE.md files and project memory still load (sub-agents docs). In a plain `claude` session the main agent did not reliably follow the routing the ledger returned; under `--agent` the runs are deterministic. Whether the delegation-discouraging wording of the default prompt causes the difference is unverified, since that wording is not published.

`--agent` also enables one option that is not used yet. The `Agent(agent_type)` syntax in a `tools` list, such as `Agent(2-project-manager, 3-developer)`, restricts which agents may be spawned. It takes effect only for an agent running as the main thread under `--agent`, and is ignored in a sub-agent definition.

## Debugging a Hung Chain

When a ledger chain stops moving under Claude Code, check the dispatcher's session for these, in order:

1. **A polling loop.** Look for an `until` loop, a Monitor, or a `sleep` waiting on a file or folder. A condition the sub-agent never creates never ends. See [Failure Mode: Invented Wait Conditions](#failure-mode-invented-wait-conditions).
2. **A step started on the hand-back.** Check whether a dependent step started after the hand-back instead of the `<task-notification>`. See [Two Messages per Dispatch](#two-messages-per-dispatch).
3. **A named dispatch.** Look for a `name` argument on the `Agent` call, a "No such tool available: SendMessage" error in the sub-agent, or a dispatcher whose task ended seconds after a named dispatch. See [Do Not Pass name or run_in_background](#do-not-pass-name-or-run_in_background).
4. **The depth limit.** Check whether the chain stopped at the same layer every time, with no handoff attempted. See [Nesting Depth](#nesting-depth).

## Where This Is Encoded

The rules derived from this behaviour live in the files below. Changes to the rules go there, not here.

- [`personas/shared/partials/subagent-wait-claude-code.md`](../../../personas/shared/partials/subagent-wait-claude-code.md) — the *Waiting for a Sub-Agent* section included by the Claude Code builds of every persona that dispatches and waits.
- [`personas/shared/partials/subagent-briefing.md`](../../../personas/shared/partials/subagent-briefing.md) — the dispatcher's rule to name that file in the prompt. The sub-agent side is wording in each affected persona's Output Location: the Plan Auditor, Plan Architect Reviewer, Usage Scenarios Curator, WP Decomposer, Dependency Sequencer, Pipeline Configurator and Synthesis.
- [`personas/ledger/src/partials/handoff-block-claude-code.md`](../../../personas/ledger/src/partials/handoff-block-claude-code.md) — the ledger handoff for agents 3–8, which dispatch once and do not wait.
- [Personas manifest → Shared Partials](../../../personas/docs/agents/project-manifest/api-surface.md#shared-partials-personassharedpartials) — the partial's entry, listing its includers.
- [Persona Design Guide → Platform Dispatch Arguments](../../../personas/docs/persona-design-guide.md#platform-dispatch-arguments) — the design rules and the checklist item on asynchronous platforms.
- [Persona Design Guide → Common Pitfalls](../../../personas/docs/persona-design-guide.md#common-pitfalls) — the "Invented wait condition" and "Output file left out of the prompt" pitfalls.

---

*Verified: Claude Code docs (sub-agents, tools reference) and session logs, 2026-10-23 → 2026-10-26, against Claude Code 2.1.310; the report-file note on 2026-10-28, against 2.1.312. Re-check on a new Claude Code major version.*
