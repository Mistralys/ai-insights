# Automatic Agent Handoffs — Planner Brief

## Goal

Enable agents in the 7-stage workflow to automatically invoke the next agent via VS Code's `runSubagent` tool, eliminating the manual step where the user reads the handoff block, opens a new chat, and pastes the next persona.

## Approach: MCP-Driven Routing with Runtime Agent Discovery

The MCP ledger remains the single source of truth for routing. The `ledger_get_handoff_status` tool response is extended with an `auto_handoff` object that tells the calling agent exactly which VS Code agent to invoke and what prompt to pass. Agent names are **not** hardcoded — the MCP server discovers them at runtime by reading the `*.agent.md` files from a configured directory.

---

## Architecture

### 1. Agent Discovery via `*.agent.md` Files

The MCP server receives the path to the VS Code `*.agent.md` files directory (the VS Code User prompts folder) as a configuration parameter — either via a CLI argument, environment variable, or `.mcp.json` args.

At startup (or lazily on first handoff), the server:

1. Scans the configured directory for `*.agent.md` files
2. Reads each file's YAML frontmatter to extract the `name:` field (e.g., `'3 - Developer v3.1.2'`)
3. Matches agent files to internal workflow roles using a naming convention or mapping heuristic (e.g., filename prefix `3-dev` → role "Developer", or by parsing the name field)
4. Builds an in-memory `AGENT_HANDLE_MAP: Record<string, string>` mapping role names to VS Code agent names

This eliminates version drift — when a persona is updated from `v3.1.2` → `v3.2.0`, the MCP server picks up the new name automatically on next startup.

**Example result:**

```typescript
// Built dynamically from *.agent.md frontmatter
{
  'Planner':         '1 - Planner v1.0.4',
  'Project Manager': '2 - Project Manager v3.1.2',
  'Developer':       '3 - Developer v3.1.2',
  'QA':              '4 - QA v3.1.2',
  'Reviewer':        '5 - Reviewer v3.1.2',
  'Documentation':   '6 - Documentation v3.1.2',
  'Synthesis':       '7 - Synthesis v3.1.2',
}
```

**Mapping heuristic:** Add a `role:` field to each `*.agent.md` frontmatter that exactly matches the MCP workflow role name. The server reads this field to build the handle map. This is explicit, stable, and avoids fragile name-parsing or filename-convention heuristics.

Example frontmatter:

```yaml
---
name: '3 - Developer v3.1.2'
role: 'Developer'
description: 'Step 3/7 in the agent workflow.'
tools: ['vscode', 'execute', 'read', 'edit', 'search', 'web', 'agent', 'todo', 'central_pm/*']
---
```

The server ignores any `*.agent.md` file that lacks a `role:` field (e.g., standalone agents like Researcher that are not part of the pipeline).

### 2. Extended Handoff Response

The existing `buildHandoffResponse()` function in `workflow.ts` is extended. When the handoff status indicates a clear next agent (e.g., `READY_FOR_QA`, `READY_FOR_REVIEW`), the response includes an `auto_handoff` object:

```json
{
  "current_agent": "Developer",
  "next_agent": "QA",
  "status": "READY_FOR_QA",
  "details": "All work packages have PASS implementation pipelines.",
  "auto_handoff": {
    "agent_name": "4 - QA v3.1.2",
    "prompt": "You are starting a new automated session. Handoff depth: 1/10\nProject path: /path/to/plan\n\n1. Load MCP tools: call tool_search_tool_regex with pattern \"ledger_\"\n2. Verify MCP connectivity: call ledger_get_project_status\n3. Determine your work: call ledger_get_next_action with agent_role: \"QA\"\n4. Execute all actionable work packages until none remain.\n5. When done, call ledger_get_handoff_status with current_agent: \"QA\".\n6. If the response contains an auto_handoff object, invoke runSubagent with the provided agent_name and prompt.\n7. If no auto_handoff is present, end your turn with the standard handoff block."
  }
}
```

When auto-handoff should **not** happen (status is `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`), the `auto_handoff` field is omitted, and the agent falls back to the manual handoff block as today.

### 3. Handoff Prompt Builder

A new function `buildHandoffPrompt(agentRole, projectPath, depth)` constructs a self-contained bootstrap prompt for the next agent. The prompt must include:

- The project path (so the agent knows where to find the ledger)
- The agent's role name (so it can call `ledger_get_next_action` correctly)
- MCP tool loading instructions (since subagents start with a clean context)
- The auto-handoff continuation rule (so the chain continues)
- The current handoff depth (for loop safety)

### 4. Loop Safety

A `handoff_depth` counter is passed through the prompt chain. Each agent increments it before invoking the next. When `depth >= MAX_HANDOFF_DEPTH` (suggested: 10, which allows one full 7-stage pass plus a few rework cycles), `auto_handoff` is omitted, forcing the workflow back to manual mode.

### 5. Human Override

| Level | How | Effect |
|-------|-----|--------|
| **Global disable** | Server config flag or remove `auto_handoff` generation | Reverts entirely to manual workflow |
| **Per-transition gate** | Blocklist in the server (e.g., never auto-handoff into Synthesis — require human sign-off before final report) | Selective human review points |
| **Runtime override** | Depth limit exceeded, or agent detects `BLOCKED` / `IN_PROGRESS` status | Automatic fallback to manual |

### 6. Persona File Changes

Each persona (agents 2–7) gets one additional instruction in its Workflow section:

> **Automatic Handoff:** After calling `ledger_get_handoff_status`, check the response for an `auto_handoff` object. If present, invoke `runSubagent` with `agentName` set to `auto_handoff.agent_name` and `prompt` set to `auto_handoff.prompt`. If `auto_handoff` is absent, end your turn with the standard CURRENT AGENT / NEXT AGENT / STATUS block for manual routing.

No routing logic, no agent name hardcoding in personas.

---

## Changes Summary

| Component | Change | Scope |
|-----------|--------|-------|
| **MCP Server — config** | Accept `agents_dir` parameter (path to `*.agent.md` files) | `index.ts`, `.mcp.json` |
| **MCP Server — new module** | Agent discovery: scan dir, parse frontmatter, build handle map | New file (e.g., `utils/agent-registry.ts`) |
| **MCP Server — `pipeline-maps.ts`** | Export the dynamically-built `AGENT_HANDLE_MAP` (or provide via the registry) | Existing file |
| **MCP Server — `workflow.ts`** | Extend `buildHandoffResponse()` with `auto_handoff` field; add `buildHandoffPrompt()` function; pass `projectPath` through handoff chain | Existing file |
| **Persona files (×7)** | Add one "Automatic Handoff" instruction paragraph to Workflow section | Existing files |
| **Persona files — frontmatter** | Add `role:` field to agent.md frontmatter for explicit role mapping | Existing files |
| **`sync-personas.js`** | No changes needed — it already syncs personas to VS Code; agent discovery happens at MCP runtime | No change |

---

## Workflow After Implementation

```
Developer completes pipeline
  → calls ledger_get_handoff_status
  → MCP server returns { next_agent: "QA", auto_handoff: { agent_name: "4 - QA v3.1.2", prompt: "..." } }
  → Developer calls runSubagent(agentName="4 - QA v3.1.2", prompt="...")
  → QA agent starts, loads MCP tools, calls ledger_get_next_action
  → QA processes all work packages
  → QA calls ledger_get_handoff_status
  → MCP server returns { next_agent: "Reviewer", auto_handoff: { ... } }
  → QA calls runSubagent(agentName="5 - Reviewer v3.1.2", prompt="...")
  → ... chain continues through Documentation → Synthesis
  → Synthesis gets auto_handoff: null (status: COMPLETE) → emits manual handoff block → chain ends
```

---

## Constraints & Decisions for Planning

- The Planner agent (stage 1) does **not** participate in auto-handoff — there is no ledger at that point. The Planner → PM transition should remain manual (user reviews the plan before PM starts).
- The `agents_dir` configuration should support the platform-specific VS Code prompts paths (macOS: `~/Library/Application Support/Code/User/prompts/`, Linux: `~/.config/Code/User/prompts/`, Windows: `%APPDATA%/Code/User/prompts/`). Consider allowing both an explicit path and a "detect from platform" default.
- The handoff prompt must include the `project_path` — this is available as `args.project_path` in `getHandoffStatus`, so no new parameters are needed from the caller.
- The `auto_handoff` field should only appear for forward transitions (`READY_FOR_*` statuses). Rework loops (e.g., QA FAIL → Developer) should also auto-handoff if depth permits, since the Developer's `get_next_action` will correctly pick up the FAIL pipeline.
- Tests should cover: (1) agent discovery from mock directory, (2) `auto_handoff` present/absent in handoff response, (3) depth limit enforcement, (4) rework loop scenarios.
