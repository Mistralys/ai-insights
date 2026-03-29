# Plan

## Summary

The Project Manager persona's sub-agent invocation instructions (steps 3–6) use invalid routing identifiers (`@wp-decomposer`, `@dependency-sequencer`, `@pipeline-configurator`, `@ledger-bootstrapper`) that match neither the agents' `id` fields nor their `name` fields. This causes the PM to fall back to writing a custom prompt that re-describes the sub-agent's role, bypassing the sub-agent's built-in persona instructions. The fix rewrites the VS Code target blocks for steps 3–6 to use explicit `runSubagent` parameter instructions — mirroring the already-working handoff block pattern from step 10.

## Architectural Context

### How VS Code sub-agent routing works

The `runSubagent` tool has three parameters:
- `agentName` (optional): The exact `name` from an agent's frontmatter (e.g., `"WP Decomposer v1.0.0"`). When provided, VS Code routes the call to that agent mode.
- `description`: A short task label.
- `prompt`: The task data passed to the sub-agent.

An alternative routing mechanism is the `@{id}` prompt prefix: if the prompt starts with `@some-id`, VS Code matches it against registered agent `id` fields.

### What's broken

The PM persona template ([personas/ledger/src/content/2-project-manager.md](personas/ledger/src/content/2-project-manager.md)) contains instructions like:

```
Use `runSubagent` with the `@wp-decomposer` agent. Pass: the full plan ...
```

The string `wp-decomposer` is **none of**:
- The agent's `name`: `"WP Decomposer v1.0.0"` (used by `agentName` parameter)
- The agent's `id`: `"standalone-wp-decomposer"` (used by `@id` prompt prefix)

This applies to all four sub-agents:

| PM instruction | Agent `name`  | Agent `id` |
|----------------|---------------|------------|
| `@wp-decomposer` | `WP Decomposer v1.0.0` | `standalone-wp-decomposer` |
| `@dependency-sequencer` | `Dependency Sequencer v1.0.0` | `standalone-dependency-sequencer` |
| `@pipeline-configurator` | `Pipeline Configurator v1.0.0` | `standalone-pipeline-configurator` |
| `@ledger-bootstrapper` | `Ledger Bootstrapper v1.0.0` | `standalone-ledger-bootstrapper` |

### What works (the handoff block)

Step 10 (handoff) works correctly because:
1. The MCP server embeds the correct `@{id}` prefix in the `auto_handoff.prompt` value
2. The handoff block instructions are explicit about parameters: `description` → short label, `prompt` → the value from `auto_handoff.prompt`
3. There's a clear note: "The `@agent` routing prefix is already embedded in the prompt — do not add your own."

### Root cause

The sub-agent instructions are vague and use wrong identifiers. The PM interprets "Use `runSubagent` with the `@wp-decomposer` agent" loosely and writes a custom prompt that re-describes the sub-agent's role — overriding the agent's own built-in persona instructions.

## Approach / Architecture

Rewrite the VS Code conditional blocks for steps 3–6 to use explicit `runSubagent` parameter instructions that tell the PM to:

1. Use the `agentName` parameter for routing (find the agent in the available agents list by display name)
2. Keep `prompt` data-only — pass task inputs, never re-describe the agent's role
3. Use `description` for a short task label

This mirrors the handoff block's clarity and uses the `agentName` parameter (the standard `runSubagent` routing mechanism) rather than `@id` prompt prefixes — avoiding the need to hardcode IDs in the template.

## Rationale

**Why `agentName` over `@id` prefix:**
- `agentName` is the documented, standard routing mechanism for `runSubagent`
- The PM always has access to the `<agents>` context listing current agent names
- Avoids hardcoding `id` values in the template (which could drift if IDs are renamed)
- The `@id` prefix mechanism is ideal for MCP-server-generated handoff prompts (step 10), where the server dynamically resolves IDs at runtime

**Why not hardcode the full agent name with version:**
- Agent names include version numbers (`"WP Decomposer v1.0.0"`) which change on version bumps
- Instructions reference agents by display keyword ("the **WP Decomposer** agent") and tell the PM to look up the exact name from its available agents list
- This is version-independent and self-resolving

## Detailed Steps

1. **Edit the PM content template** — In `personas/ledger/src/content/2-project-manager.md`, replace the four `{{#if target_vscode}}` blocks for steps 3–6 with explicit parameter instructions. The new format for each step:

   ```markdown
   {{#if target_vscode}}
      Invoke `runSubagent` to call the **WP Decomposer** agent:
      - `agentName`: find the **WP Decomposer** in your available agents list — use its exact name
      - `description`: `"Decompose plan into work packages"`
      - `prompt`: the full plan document content, project name, and any explicit scope/phasing notes

      > **Important:** Do NOT include role descriptions or agent instructions in the prompt — the sub-agent has its own built-in persona. Pass only data.

      Expected output: A list of Work Package definitions, each with title, description, scope, and draft acceptance criteria.
   {{else}}
   ```

   Apply the same pattern to all four steps (WP Decomposer, Dependency Sequencer, Pipeline Configurator, Ledger Bootstrapper), substituting the agent name, description, and prompt content accordingly.

2. **Rebuild personas** — Run `node scripts/build-personas.js` to regenerate the output files and verify the template renders correctly for both VS Code and Claude Code targets.

3. **Verify generated output** — Inspect `personas/ledger/vs-code/2-pm.agent.md` to confirm the rendered workflow steps match the intended format.

4. **Deploy** — Run `node scripts/sync-personas.js` or `node scripts/cli.js` to deploy the updated personas to the VS Code prompts directory.

## Dependencies

- None — this is a self-contained change to the PM persona template.

## Required Components

- `personas/ledger/src/content/2-project-manager.md` (template source — the only file edited)
- `personas/ledger/vs-code/2-pm.agent.md` (generated output — rebuilt, not edited)
- `personas/ledger/claude-code/2-project-manager.md` (generated output — rebuilt, not edited)

## Assumptions

- The `agentName` parameter in `runSubagent` matches against the `name` field in agent frontmatter.
- The PM agent always receives the `<agents>` context listing available agents with their current names.
- The Claude Code `{{else}}` blocks do not need changes (they use `Task` tool with a `description` slug, which is a different routing mechanism).

## Constraints

- Do not edit generated persona files — only edit the template source.
- Do not change agent `id` or `name` fields in standalone persona metadata.
- Maintain parity between VS Code and Claude Code conditional blocks (same data passed, different tool syntax).

## Out of Scope

- Changing standalone persona `id` naming convention (`standalone-*` prefix)
- Updating the Claude Code target instructions (they use a different routing mechanism)
- Changes to the MCP server's handoff routing (step 10 — already working correctly)
- Version bumps or changelog entries

## Acceptance Criteria

- The PM persona template uses explicit `runSubagent` parameter format (`agentName`, `description`, `prompt`) for steps 3–6
- Instructions reference agents by display name keyword with lookup guidance, not by invalid slugs
- Instructions explicitly warn against including role descriptions in the prompt
- `node scripts/build-personas.js` succeeds without errors
- `node scripts/build-personas.js --check` passes (generated output matches source)
- Generated `2-pm.agent.md` renders correctly with no leftover template syntax

## Testing Strategy

- Rebuild personas and run `--check` to verify template integrity
- Manual inspection of the generated VS Code and Claude Code persona files
- Functional test: run the PM agent in VS Code and verify sub-agents are invoked via the correct agent mode (the sub-agent header should show the correct agent name)

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **PM still writes custom prompts despite explicit instructions** | The new format is parameter-by-parameter (matching the working handoff block pattern) with a bold warning — significantly harder to misinterpret |
| **Agent name lookup fails if PM can't find the agent in its list** | The display names are distinctive keywords (WP Decomposer, Dependency Sequencer, etc.) that are easy to match; the PM receives the agents list in its system context |
| **Claude Code blocks accidentally changed** | Only the `{{#if target_vscode}}` blocks are edited; the `{{else}}` blocks are left untouched |

---

## Implementation — DONE

**Completed:** 2026-03-28

### What was done

All four `{{#if target_vscode}}` blocks for steps 3–6 in `personas/ledger/src/content/2-project-manager.md` were replaced with explicit `runSubagent` parameter-by-parameter instructions. Each block now:

- Names the target agent using a bold display keyword (e.g., **WP Decomposer**)
- Instructs the PM to look up the exact name from its available agents list and pass it as `agentName`
- Provides a short, specific `description` string for each invocation
- Specifies exactly what data to pass as `prompt`
- Includes a bold `Important` callout explicitly warning against including role descriptions or agent instructions — pass only data

The Claude Code `{{else}}` blocks were left untouched.

### Verification

- `node scripts/build-personas.js` — succeeded, 18 ledger personas rebuilt
- `node scripts/build-personas.js --check` — all 18 files `[ok]`, no stale output
- Manual inspection of `personas/ledger/vs-code/2-pm.agent.md` — steps 3–6 render cleanly with no leftover template syntax; no `@slug` references remain
- `node scripts/sync-personas.js` — 9 VS Code ledger personas deployed and frontmatter validated

### Notes & observations

1. **Version-independence confirmed:** Using display-name keywords with lookup guidance (rather than hardcoded `"WP Decomposer v1.0.0"`) means these instructions remain valid across version bumps — the PM resolves the exact current name at runtime from its agents context.

2. **Structural consistency:** The new blocks follow the same parameter-list pattern as the already-working step 10 handoff block, making the PM's workflow instructions internally consistent throughout.

3. **Claude Code parity maintained:** The `{{else}}` blocks (using `Task` with `description: "slug"`) were intentionally left unchanged — they use a separate routing mechanism that is not broken.

4. **No drift risk:** The standalone persona `id` values (`standalone-wp-decomposer`, etc.) are not referenced anywhere in the updated template — routing is now purely via `agentName` display-name lookup, so standalone persona renames would not break PM routing.
