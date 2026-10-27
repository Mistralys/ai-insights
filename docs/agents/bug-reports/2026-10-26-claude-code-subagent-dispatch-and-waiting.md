# Bug Report: Claude Code Sub-Agent Dispatch and Waiting

**Date:** 2026-10-26
**Claude Code version:** 2.1.310, macOS (Darwin 27), terminal and VS Code extension sessions
**Status:** Workarounds in place; Findings 1, 2, 3 and 5 confirmed against the Claude Code docs. Finding 4 reproduced in three controlled runs, root causes located in the debug logs, and drafted as two upstream issues (see [Proposed Upstream Issues](#proposed-upstream-issues))
**Purpose of this document:** A brief for online research. Each finding lists what we observed, what we believe the docs say, and the open questions to verify. Repository details are explained where they matter, so the report stands on its own.

---

## Context

We run a multi-agent software workflow inside Claude Code. Custom agents (Markdown files in `~/.claude/agents/`) are dispatched as sub-agents through the `Agent` tool (also called `Task`). A pipeline of nine agents hands off work to each other. Each agent asks an MCP server (the "ledger", a project state store) who runs next, then dispatches that agent itself. Chains therefore nest several levels deep: a coordinator dispatches agent A, A dispatches B, B dispatches C, and so on.

Relevant user settings (`~/.claude/settings.json`, `env` block):

```json
"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
"CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "42"
```

The user does not want to change Claude Code settings to work around these issues, so every workaround lives in the agent instructions.

Evidence comes from an automated scan of local Claude Code session transcripts (JSONL under `~/.claude/projects/`). The scan covered eight hung sessions across five repositories (2026-09-25 → 2026-10-23), plus counts over all dispatches logged in that period. The counts below come from that scan. Finding 4 has since been reproduced in a controlled setup (see [Controlled Test Results](#controlled-test-results)); the other findings have not.

---

## Finding 1: Sub-agents always run in the background; `run_in_background: false` has no effect

**Observed**
- Every `Agent` call returns at once with a launch acknowledgement ("Async agent launched successfully") instead of the sub-agent's result.
- 285 logged dispatches passed `run_in_background: "false"` and all of them ran in the background. Of 2,189 launches in total, 2 ran in the foreground.
- **Caveat:** the value was passed as the *string* `"false"`, not the boolean. We have not ruled out that the string is coerced to truthy or simply dropped. Results may differ with a real boolean.

**Our understanding of the docs**
- In interactive sessions (terminal, VS Code, desktop), sub-agents start in the background while "fork mode" is on, and fork mode is on by default.
- Foreground behaviour is only available through the environment: `CLAUDE_CODE_FORK_SUBAGENT=0`, or `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` (which also stops Bash commands from being moved to the background).

**Questions to verify**
1. Is "background by default in interactive sessions" documented, and since which version?
2. Does `run_in_background: false` (boolean) force foreground, or is the parameter ignored whenever fork mode is on?
3. What exactly do `CLAUDE_CODE_FORK_SUBAGENT` and `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` do, and are they documented or internal?
4. Do headless runs (`claude -p`) and the Agent SDK behave the same way?

---

## Finding 2: The `sleep` block message steers agents into endless polling loops

**Observed**
- After a background dispatch, the dispatching agent wants to wait for the result. It tries `sleep`, which Claude Code blocks. The block message (and the Bash tool description) suggests using **"Monitor with an until-loop"** to wait on a condition.
- The agent follows that advice and invents a condition, typically `until [ -d {plan folder}/.ledger ]; do sleep …; done`. Nothing ever creates that folder, because the MCP server stores its state centrally, outside the project. The loop never ends.
- One session stayed hung for more than 40 hours (2026-10-19 → 2026-10-22). Seven more sessions in four other repos show the same pattern.

**Why this matters:** advice meant for waiting on shell commands gets applied to waiting on a sub-agent, where the right action is to end the turn (Finding 3).

**Questions to verify**
1. What is the exact current wording of the `sleep` block message and of the Monitor / until-loop guidance, and does it distinguish shell waits from sub-agent waits?
2. Does Monitor or an until-loop have a timeout by default, or can it run forever?
3. Is there an official recommended way for a sub-agent to wait for its own background sub-agents?
4. Has anyone reported this (GitHub issues on `anthropics/claude-code`, forums)?

---

## Finding 3: Waiting means ending the turn; two separate messages come back

**Observed**
- A model has no "block and wait" operation. It waits by ending its turn, meaning a message with no tool call. Claude Code keeps a sub-agent's task open while agents it dispatched are still running. When one of them finishes, Claude Code injects a `<task-notification>` into the dispatcher's session, which starts its next turn. In 922 logged cases a sub-agent that ended its turn was woken this way.
- Two messages come back per dispatch:
  - **Hand-back:** the sub-agent's report, shown to the dispatcher as a "[Subagent hand-back]" message. An intermediate turn-end inside the sub-agent also produces one, so it can arrive long before the task is done while a nested chain is still running.
  - **`<task-notification>`:** the sub-agent's whole task has ended, including everything it dispatched. Its `<note>` says it "fires each time this agent stops with no live background children of its own", so the same task ID can notify more than once.

**Our understanding of the docs:** an interactive sub-agent that launches background sub-agents "waits for their results before it finishes".

**Questions to verify**
1. Is the hand-back vs. task-notification distinction documented? What is the official term for each?
2. Is it guaranteed that a sub-agent's task stays open while its own background children run, at every nesting depth?
3. Under which conditions does a repeat notification for the same task ID fire?
4. How does `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` interact with this, and what is the default depth limit?

---

## Finding 4: With agent teams enabled, a named dispatch starts a teammate without `SendMessage`

*Revised 2026-10-26 after a rescan of the transcripts (see [Second Look Requested](#second-look-requested)). The first version of this finding read "10 of 72 teammate launches failed", which made the failure look intermittent. It is not.*

**Observed**
- With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, an `Agent` call that includes a `name` starts an in-process *teammate* instead of a plain sub-agent. Claude Code tells the teammate it "MUST use SendMessage" to report.
- This happens whether the call comes from the main session or from a sub-agent. Each sub-agent transcript (`~/.claude/projects/{project}/{session}/subagents/agent-*.jsonl`) has a sibling `.meta.json`. For named launches it records `taskKind: "in_process_teammate"`, a `teamName` of `session-{session id}`, and a `parentAgentId` when a sub-agent made the call.
- No teammate in the logs had `SendMessage`. Every one that tried to call it failed with "No such tool available: SendMessage", and the rest never tried.
- **Cause, isolated in the controlled test:** a teammate gets `SendMessage` only when the session's main-thread agent holds it. Every logged session ran under `claude --agent` with a persona whose `tools:` list omits it.
- A teammate's final reply arrives as an idle notification to the team lead, which is the main session. When the main session made the call, the reply reaches it. When a sub-agent made the call, the reply reaches nobody. The sub-agent's own task ends without waiting for the teammate, so its dispatcher is told it finished while the teammate is still working (see [Controlled Test Results](#controlled-test-results), cases B and D).

**Evidence (68 named launches, 2026-09-25 → 2026-10-26, ten Claude Code project folders across six repositories)**

| | Count |
|---|---|
| Named launches, all `taskKind: in_process_teammate` | 68 |
| … made by a sub-agent (`parentAgentId` set) | 67 |
| … made by the main session | 1 |
| Teammates told "MUST use SendMessage" (text found in the transcript) | 68 |
| Teammates that called `SendMessage` | 10 — all 10 failed with "No such tool available" |
| Teammates that never called it, ending with a plain final message | 58 |

- **Failures by agent:** `ledger-wp-decomposer` 7 of 16, `ledger-dependency-sequencer` 1 of 7, `ledger-pipeline-configurator` 1 of 7, `whatsnew-curator` 1 of 1. The other 37 launches (Bootstrapper, Knowledge Archiver, Changelog Curator and others) never called the tool.
- **Spawn depth** (`spawnDepth`) ranged from 0 to 18. The failures sat at depths 1 and 2, which is where those agents are normally dispatched.
- **Claude Code versions:** 2.1.282 to 2.1.309. Failures occurred on 2.1.282, 2.1.287, 2.1.294, 2.1.300, 2.1.303 and 2.1.309.
- **Permission modes:** auto (48 launches, 5 failures) and bypassPermissions (20 launches, 5 failures).
- **Every launch** was recorded with `requestShape: "background"` and `requestNonInteractive: true`.
- **Tool lists:** every agent involved declares a `tools:` list in its frontmatter, and none of these lists names `SendMessage`. The lists were read from the agent files deployed today. The files may have differed slightly at launch time, but no version ever listed `SendMessage`.

**What the docs say, and where the logs disagree.** The research pass cited the [agent teams docs](https://code.claude.com/docs/en/agent-teams), which say nested teams are unsupported, and the [sub-agents docs](https://code.claude.com/docs/en/sub-agents), which say a named spawn starts a teammate *when made from the main conversation*. It concluded that a named spawn from a sub-agent is a plain named sub-agent. The `.meta.json` records contradict that: 67 of these launches came from sub-agents and every one was a teammate. The research pass also expected teammates to get `SendMessage` added automatically. None of these teammates got it.

**Workaround:** dispatches pass only `subagent_type`, `description` and `prompt`, never `name`.

**Questions to verify**
1. Is it documented that `name` switches a dispatch to a teammate when agent teams are on, including when a sub-agent makes the call?
2. Is a sub-agent's named spawn joining the session's team (`teamName: session-{id}`) intended, or a gap in how "nested teams are unsupported" is enforced?
3. Is `SendMessage` supposed to be added to a teammate whose agent definition has an explicit `tools:` list that omits it? *Answered: yes, per the definition-level rules. The [agent-teams docs](https://code.claude.com/docs/en/agent-teams#use-subagent-definitions-for-teammates) say Claude Code adds `SendMessage` to an in-process teammate's `tools` list and keeps it even where `disallowedTools` names it. They say nothing about the session-level cap that the controlled test found.*
4. Which docs, if any, say a teammate whose definition declares `tools:` gets `SendMessage` added automatically? *Answered: the sub-agents and agent-teams docs, as quoted in the second research pass.*
5. What is the current status of the agent-teams feature?

---

## Finding 5: The default session does not follow external routing; `claude --agent` does

**Observed (operational experience, not quantified)**
- In a plain `claude` session that delegates to the coordinator agent or the pipeline agents, the main agent does not reliably follow the routing the MCP server returns. It skips stages, does an agent's work inline, or decides a step is unnecessary, without reporting an error.
- Starting the session with the coordinator as main agent, `claude --agent ledger-claude-coordinator`, makes runs deterministic. This setup is now used successfully in production.

**Hypothesis (unverified):** with `--agent`, the custom agent's instructions replace the default system prompt. The default prompt and the `Agent` tool description push the model to do small tasks itself rather than delegate ("Do the work yourself when it is a handful of tool calls", "When in doubt, don't spawn"). That bias works against a workflow where every stage must be delegated. Under `--agent` the tool description is still present, so if the hypothesis holds, the system prompt is the deciding part.

**Questions to verify**
1. What does `--agent` change: does it replace the default system prompt, append to it, or only set the main agent's tools and model?
2. Is there official guidance on running an orchestrator agent as the main session agent vs. as a sub-agent?
3. Are the delegation-discouraging phrases part of the published `Agent` tool description or system prompt, and have they changed recently?

---

## Workarounds in Place

All dispatching agents carry a shared instruction block:
- Never poll for a sub-agent (no `sleep`, until-loop, Monitor, or watching for files).
- End the turn; the task notification starts the next step. Ending the turn is not ending the task.
- Act on the task notification, not the hand-back.
- Pass only `subagent_type`, `description` and `prompt`.
- Re-issue a dispatch that returned an error once, then fall back to the step's failure handling.

The pipeline is launched with `claude --agent ledger-claude-coordinator`.

## What a Useful Research Answer Looks Like

For each question: the answer, a link to the official source (Claude Code docs, changelog, or GitHub issue), and the version it applies to. Where no official source exists, say so rather than inferring. Findings our sources contradict matter most.

## Research Outcome

Researched on 2026-10-26 against the [sub-agents docs](https://code.claude.com/docs/en/sub-agents) and the [tools reference](https://code.claude.com/docs/en/tools-reference). The workarounds above all stand. The details now live in the [dispatch reference](../references/claude-code-subagent-dispatch.md).

- **Finding 1 — confirmed.** Fork mode, on by default, prevents Claude from waiting in interactive sessions, so `run_in_background` is ignored whatever its type. Both environment variables are documented. Headless runs can wait.
- **Finding 2 — explained.** A foreground Bash loop that times out is moved to the background, and local interactive sessions put no time limit on background commands. Monitor watches end after 30 minutes at most but can be restarted. The wording of the `sleep` block message is not published.
- **Finding 3 — confirmed.** The docs call the second message the completion notification. The hand-back comes from `SubagentHandback`, which exists only in auto mode. Repeat notifications are not documented. The default depth is three layers, so the chain depends on the raised limit.
- **Finding 4 — the research pass's explanation did not hold.** It expected a sub-agent's named spawn to be a plain sub-agent; the transcripts show every one was a teammate. The evidence and revised questions are in [Finding 4](#finding-4-with-agent-teams-enabled-a-named-dispatch-starts-a-teammate-without-sendmessage); the controlled test is under [Controlled Test Results](#controlled-test-results).
- **Finding 5 — confirmed.** A custom agent's prompt replaces the default system prompt under `--agent`; CLAUDE.md still loads. The delegation-discouraging wording is not published.

## Second Look Requested

The first research pass explained Finding 4 from the docs. A rescan of the transcripts' `.meta.json` records then contradicted part of that explanation. Finding 4 was rewritten with the full evidence and five revised questions, and sent back for a second look.

### Second Research Pass (2026-10-26)

- **Teammates spawned by sub-agents:** the docs do not describe this path. The agent-teams page says teammates cannot spawn teammates; it says nothing about sub-agents doing so. The `.meta.json` records settle what actually happens.
- **The `SendMessage` auto-add:** the docs describe it as unconditional for in-process teammates. It applies even where `disallowedTools` names the tool, and to a teammate brought back without its definition. Observed behaviour contradicts this, which makes it reportable.
- **GitHub:** no matching issue. #35240, #37051 and #38183 concern `SendMessage` missing for *resumed* agents with teams off (around v2.1.77, since superseded). #92183 concerns the desktop app passing `--disallowedTools SendMessage`, with a different error text.
- **`requestNonInteractive: true`:** every launch carries it, while the docs say a named sub-agent runs as an ordinary sub-agent in non-interactive mode, even with teams on. The field probably describes the sub-agent's own request rather than the session, but maintainers should see it.
- **Agent teams:** still experimental and off by default.
- **Hedge on Finding 3:** the research pass asked whether the 20 `bypassPermissions` launches also showed hand-backs, which would point to a second, undocumented source. The transcripts say no. All 108 sessions containing "[Subagent hand-back]" messages ran in auto mode. The `bypassPermissions` value belongs to the teammates' own `.meta.json`, and no teammate ever called `SubagentHandback`.

## Controlled Test Results

Three runs on 2026-10-26, Claude Code 2.1.310, auto mode, each case in a fresh session. Run 1 (cases A–D) was started with `claude --agent lead`. The lead agent declares `tools: Agent, Read, Bash`. The setup and prompts are in [`send-message-reproduction/`](send-message-reproduction/README.md). Run 1 was started inside this repository, so its CLAUDE.md and AGENTS.md were loaded into every agent; this affects the agents' wording but not which tools they had. Run 2 (cases E and F) was started outside any repository with `claude --agent lead-sm`, whose `tools:` list is the same plus `SendMessage`. Run 3 (cases B2, H1, H2 and G) was started outside any repository with `--debug`; case G used a plain `claude` session without `--agent`.

| Case | Spawned by | Probe's `tools:` | `taskKind` | Tools the probe had | `SendMessage` |
|---|---|---|---|---|---|
| A | lead | `Read, Bash` | `in_process_teammate` | Read, Bash | Called → "No such tool available: SendMessage" |
| B | `relay`, a plain sub-agent | `Read, Bash` | `in_process_teammate` | Read, Bash | Called → "No such tool available: SendMessage" |
| C | lead | none | `in_process_teammate` | Agent, Read, Bash | Called → "No such tool available: SendMessage" |
| D | `relay`, a plain sub-agent | none | `in_process_teammate` | Agent, Read, Bash | Not called: the probe saw no definition for it and declined |
| E | `lead-sm` | `Read, Bash` | `in_process_teammate` | Read, Bash, **SendMessage** | Called → "Message sent to team-lead's inbox" |
| F | `lead-sm` | none | `in_process_teammate` | Agent, Read, Bash, **SendMessage** | Called → "Message sent to team-lead's inbox" |
| B2 | `relay` under `lead` | `Read, Bash` | `in_process_teammate` | Read, Bash | Called → "No such tool available: SendMessage" |
| H1 | `relay` under `lead-sm` | `Read, Bash` | `in_process_teammate` | Read, Bash, SendMessage | Called → "Message sent to team-lead's inbox", but never received |
| H2 | `relay` under `lead-sm` | none | `in_process_teammate` | Agent, Read, Bash, SendMessage | Called → "Message sent to team-lead's inbox", but never received |
| G | plain `claude` session | `Read, Bash` | `in_process_teammate` | Read, Bash, SendMessage | Called → "Message sent to team-lead's inbox", received by the lead |

The tool lists are the probes' own reports. Run 3's `--debug` logs are an independent record: they show `Unknown tool SendMessage` in B2, and the mailbox writes and reads quoted below. The error results and `.meta.json` fields come from the transcripts. All ten probes were started with a `<teammate-message teammate_id="team-lead">`, including the five started by the relay.

**1. Nesting is not the cause of the tool error.** Teammates spawned by the lead lack `SendMessage` exactly as nested ones do. On the default path the tool is present: in case G, a plain session without `--agent`, the teammate received `SendMessage` and the lead got its message. The tool error is specific to `--agent` with a `tools:` list that omits `SendMessage`.

**2. The main-thread agent's `tools:` list caps every teammate, including the `SendMessage` auto-add.** Probes C and D declare no `tools:` line, yet they received exactly the lead's list, `Agent, Read, Bash`. In case D the relay that started the probe has no `Bash`, so the tools came from the lead, not from the dispatcher. Cases E and F changed only one thing, adding `SendMessage` to the lead's list, and both probes then had it and used it. Probe E's own `tools: Read, Bash` omits it, so the auto-add does work, but only for a tool the main-thread agent holds.

The cap itself is documented: an in-process teammate "runs under the lead's live allow and deny rules, so `--disallowedTools`, `--tools`, and `--allowedTools` all apply to it" ([agent-teams docs, Permissions](https://code.claude.com/docs/en/agent-teams#permissions)), and under `--agent` the main thread takes on the agent's tool restrictions. What is not documented is the interaction. The docs exempt the `SendMessage` auto-add from the definition's `disallowedTools` but say nothing about the session-level cap, and Claude Code still tells every teammate it "MUST use SendMessage" when it has withheld the tool.

**3. A named dispatch from a sub-agent detaches the child, and the lead never reads its messages.** In cases B, D, B2, H1 and H2 the relay dispatched the named probe, ended its turn as instructed, and its task ended within seconds instead of waiting. Claude Code then sent it, verbatim: `[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.` This mechanism is undocumented; it shows Claude Code itself detected that the relay ended without a report. The relay handed back a report saying no result had arrived, and the lead received the relay's completion notification while the probe was still working.

None of the five probes' results reached anyone. The `--debug` logs of run 3 ([`send-message-reproduction/debug-logs/`](send-message-reproduction/debug-logs/)) show why:

- **The messages are written correctly.** Each teammate message, including the idle notification, is a write to the lead's mailbox file, `~/.claude/teams/session-{id}/inboxes/team-lead.json`. In H1 and H2 the logs show two writes each, `writeToMailbox: recipient=team-lead, from=probe-h1`: the probe's `SendMessage` and then its idle notification. In B2 the idle notification was written the same way.
- **The lead never reads its mailbox.** In case G, where the lead spawned the teammate itself, the lead's `InboxPoller` started reading `team-lead.json` one second after the spawn: 39 reads, then "Found 1 unread message(s) … submitting immediately". In B2, H1 and H2 the logs contain no `InboxPoller` line and no mailbox read by the lead. The poller apparently starts only when the lead itself spawns a teammate.

This rules out the earlier guess that the result is addressed to the exited relay. It is addressed to the lead and delivered to its mailbox; the lead just never polls. Holding `SendMessage` makes no difference (H1, H2). The sessions stayed open 35–40 seconds after each probe finished, shorter than the two minutes the README asked for. That does not matter here, since the poller never started at all.

The result contradicts the docs: "when a teammate finishes and stops, it automatically notifies the lead and includes its final answer in the notification" ([agent-teams docs, Context and communication](https://code.claude.com/docs/en/agent-teams#context-and-communication)).

For a dispatch chain this is worse than the tool error. A named dispatch removes the child from the dispatcher's task. The dispatcher's completion notification then fires while the child is still working, and the child's result goes nowhere.

**Additional questions**

6. Is a teammate's tool set meant to be capped by the main-thread agent's `tools:` list? If so, should the `SendMessage` auto-add, and the instruction to use it, depend on the main-thread agent holding the tool? *Run 2 shows it is capped; whether that is intended is open.*
7. Should a sub-agent's task wait for a teammate it spawned? And should the lead's inbox poller start when a sub-agent, rather than the lead, adds the first teammate to the session's team?

The workaround (never pass `name`) avoids all three effects. Adding `SendMessage` to the main-thread agent's tools would fix effects 1 and 2 but not effect 3, which is why the workaround stays. Upstream, effects 1 and 2 are a documented-versus-observed discrepancy, and effect 3 is a lost result.

## Proposed Upstream Issues

The two effects touch different code paths and differ in severity, so they go to `anthropics/claude-code` as two issues. Each issue quotes the docs passages above, attaches the reproduction folder and the `--debug` logs, and notes that the probes' tool lists are self-reports.

**Issue 1 — Teammates are told to use `SendMessage` that the session withheld.** Filed as [anthropics/claude-code#105255](https://github.com/anthropics/claude-code/issues/105255). Under `claude --agent X`, where X declares a `tools:` list without `SendMessage`, in-process teammates do not receive `SendMessage`. The documented auto-add does not escape the session-level tool cap, yet every teammate is told it "MUST use SendMessage". Evidence: cases A, C, E and F, plus 68 logged launches; case G shows the default path without `--agent` is unaffected. Acceptable fixes: exempt the auto-add from the cap, or drop the instruction when the tool is absent.

**Issue 2 — A named `Agent` call from a sub-agent loses the teammate's result.** With agent teams enabled, a named `Agent` call made by a sub-agent spawns a teammate of the session's team. The teammate is detached from the sub-agent's task: the sub-agent's task ends without waiting. The teammate's messages and idle notification are written to the lead's mailbox, but the lead's `InboxPoller` never starts, so the lead never receives them. This contradicts the documented idle notification. The docs do not describe this path at all; their "no nested teams" limitation covers teammates spawning teammates, not sub-agents doing so. Evidence: cases B, D, B2, H1 and H2 (five of five), with the `--debug` mailbox lines from H1 against G. Include the `[handback-send-enforce]` message verbatim.

Neither issue changes the workaround. Dropping `name` avoids all three effects, and a named sub-agent dispatch offers nothing the completion notification does not already provide.
