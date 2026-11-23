---
title: IDE and Runtime Settings
---

# IDE and Runtime Settings

> **Companion to:** [workflow-and-ledger.md](workflow-and-ledger.md)
> **Verified:** 2026-11-23

The personas and the ledger workflow depend on a few settings in the IDE or agent runtime that run them. None of them ships with the repository: each has to be set on every machine that runs the pipeline. This page lists them for Claude Code and VS Code, with the value the workflow needs and what breaks without it.

Ledger agents hand off to each other by dispatching their successor as a sub-agent (see [The Agent Handoff Protocol](workflow-and-ledger.md#the-agent-handoff-protocol)). Every handoff therefore nests the chain one level deeper, and most of the settings below exist because of that nesting.

---

## Table of Contents

- [Summary](#summary)
- [Claude Code](#claude-code)
  - [CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH](#claude_code_max_subagent_spawn_depth)
  - [CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS (be aware)](#claude_code_experimental_agent_teams-be-aware)
- [VS Code](#vs-code)
  - [chat.agentFilesLocations](#chatagentfileslocations)
  - [chat.subagents.allowInvocationsFromSubagents](#chatsubagentsallowinvocationsfromsubagents)
  - [chat.customAgentInSubagent.enabled](#chatcustomagentinsubagentenabled)
- [Not an IDE Setting: the Ledger's Handoff Ceiling](#not-an-ide-setting-the-ledgers-handoff-ceiling)
- [Sources](#sources)

---

## Summary

| Setting | Platform | Status |
|---------|----------|--------|
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | Claude Code | **Required** for ledger chains |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Claude Code | Not required — be aware of its effect |
| `chat.agentFilesLocations` | VS Code | Keep the default — unverified |
| `chat.subagents.allowInvocationsFromSubagents` | VS Code | Unverified |
| `chat.customAgentInSubagent.enabled` | VS Code | Unverified — not in the current official settings reference |

---

## Claude Code

### CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH

| | |
|---|---|
| **Platform** | Claude Code |
| **Where it is set** | The `env` block of Claude Code's `settings.json`. It is read at startup, so restart Claude Code after changing it. |
| **Value we need** | A number larger than the longest chain you expect to run. Count the layers below the main conversation: the agent the [Ledger Claude Coordinator](workflow-and-ledger.md#claude-code-coordinator-as-main-agent) seeds is layer 1, and every `auto_handoff` after it adds one. The Synthesis agent's dispatch of the Knowledge Archiver adds one more, and every rework round trip adds two. |
| **Why the workflow depends on it** | By default a sub-agent can spawn sub-agents only up to three layers below the main conversation. At the limit, Claude Code withholds the `Agent` (`Task`) tool from the sub-agent, so it has no tool to hand off with. A full ledger chain nests deeper than three layers. |
| **What fails without it** | The chain stops at the third layer: the agent there finishes its own stage but cannot dispatch its successor. The coordinator then has to reseed the chain far more often. Observed failure: the 9-synthesis agent ran without the `Task` tool, so the Knowledge Archiver never ran. The persona's Step 8 fallback recorded a project comment instead, and no knowledge was collected for that project. |

The maintainers run with `42`, which no ledger chain comes close to:

```json
{
  "env": {
    "CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH": "42"
  }
}
```

The official docs note that setting `1` turns nesting off entirely. The default has changed between Claude Code versions; the history and the session-log evidence are in [Claude Code — Sub-Agent Dispatch and Waiting → Nesting Depth](../agents/references/claude-code-subagent-dispatch.md#nesting-depth).

### CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS (be aware)

| | |
|---|---|
| **Platform** | Claude Code |
| **Where it is set** | Claude Code's environment, for example the `env` block of `settings.json`. |
| **Value we need** | None. The workflow does not require it. |
| **Why it matters** | With it set, an `Agent` call that carries a `name` starts an in-process teammate instead of a plain sub-agent. The teammate is told to report through `SendMessage`, a tool it does not have, and the dispatcher's task ends without waiting for it. |
| **What fails with it** | A named dispatch detaches the successor: its result reaches no one, and the coordinator sees the run end early. This is why every persona dispatches with only `subagent_type`, `description` and `prompt`. Details and test evidence: [Do Not Pass name or run_in_background](../agents/references/claude-code-subagent-dispatch.md#do-not-pass-name-or-run_in_background). |

---

## VS Code

> **Unverified.** Nobody has yet tested how VS Code nests sub-agents when it runs these personas. The entries below record what the official settings reference says, so that a first test knows where to look. None of them is a confirmed requirement.

The VS Code builds of the ledger agents hand off the same way as the Claude Code builds: when the ledger returns an `auto_handoff`, the agent invokes `runSubagent` with its prompt. `node scripts/sync-personas.js` deploys the VS Code personas to `~/.copilot/agents/` (the location is defined in `shared/publish-locations.json`).

### chat.agentFilesLocations

| | |
|---|---|
| **Platform** | VS Code (GitHub Copilot) |
| **Where it is set** | VS Code settings (`settings.json`). |
| **Value we need** | Any value that still includes `~/.copilot/agents`. The default includes `.github/agents`, `.claude/agents` and `~/.copilot/agents`, so the default works. |
| **Why the workflow depends on it** | It lists the paths VS Code searches for custom agents. The persona sync writes the agents to `~/.copilot/agents/`. |
| **What fails without it** | Unverified. If the setting is changed to drop `~/.copilot/agents`, VS Code would no longer find the synced personas, so they could not be selected or reached through a handoff. |

### chat.subagents.allowInvocationsFromSubagents

| | |
|---|---|
| **Platform** | VS Code (GitHub Copilot) |
| **Where it is set** | VS Code settings (`settings.json`). Default: `false`. |
| **Value we need** | Unknown. |
| **Why the workflow may depend on it** | It lets a subagent invoke further subagents, up to a depth of five. A ledger chain needs exactly that, since each handoff is a subagent invoking its successor. |
| **What fails without it** | Unverified. The official reference says the setting affects only the "Local harness", which is deprecated and due for removal in February 2027. Whether our setup runs on that harness, and how the current harness limits nesting, has not been checked. |

### chat.customAgentInSubagent.enabled

| | |
|---|---|
| **Platform** | VS Code (GitHub Copilot) |
| **Where it is set** | VS Code settings (`settings.json`), if it still exists. |
| **Value we need** | Unknown. |
| **Why it is listed** | An implementation note from March 2026 says it must be `true` for a subagent call to run a custom agent. That note reads like a pasted chatbot answer, and the `chat.customAgents` block it shows alongside it is not a real VS Code setting, so treat its claims as unconfirmed. |
| **What fails without it** | Unverified. The current official settings reference does not list this setting; it may have been renamed or removed. |

---

## Not an IDE Setting: the Ledger's Handoff Ceiling

The ledger also caps how many automatic handoffs a project can make, independently of the IDE. That ceiling is part of the MCP server's configuration, not of Claude Code or VS Code, so it is not covered here. When a chain stops short of COMPLETE, either limit can be the cause; see [Claude Code (Coordinator as Main Agent)](workflow-and-ledger.md#claude-code-coordinator-as-main-agent).

---

## Sources

- Claude Code sub-agents docs: <https://code.claude.com/docs/en/sub-agents>, section *Let subagents spawn their own subagents*
- VS Code Copilot settings reference: <https://code.visualstudio.com/docs/agents/reference/copilot-settings>
- [Claude Code — Sub-Agent Dispatch and Waiting](../agents/references/claude-code-subagent-dispatch.md) — dispatch behaviour, nesting depth history, session-log evidence
- VS Code subagent calling note (2026-03), `docs/agents/implementation-history/2026-03/2026-03-04-subagent-routing-fix/vs-code-subagent-calling.md` in the repository (not published on the documentation site) — the unconfirmed source of the `chat.customAgentInSubagent.enabled` entry
