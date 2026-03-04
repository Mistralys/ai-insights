# Plan

## Summary

VS Code subagent routing is broken in the persona handoff workflow. When an agent hands off to the next agent via `runSubagent`, the target agent's persona is never loaded because: (a) `runSubagent` has no `agentName` parameter — it routes via a `@agentId` prompt prefix, (b) our `.agent.md` files lack `id:` frontmatter fields so VS Code auto-generates unstable IDs, and (c) the handoff block instructs agents to pass a nonexistent `agentName` parameter. This plan introduces stable `id:` fields across the entire persona pipeline — both ledger and standalone personas — and teaches the MCP server to inject the `@id` routing prefix into auto-handoff prompts so agents never need to know about the routing mechanism.

## Architectural Context

### Affected Component Chain

| Component | File(s) | Current State |
|---|---|---|
| **Ledger persona YAML metadata** | `personas/ledger/src/meta/1-planner.yaml` through `7-synthesis.yaml` | No `id` field in any of the 7 files |
| **Ledger shared YAML metadata** | `personas/ledger/src/meta/_shared.yaml` | No `id`-related fields |
| **Standalone persona YAML metadata** | `personas/standalone/src/meta/*.yaml` (10 files) | No `id` field in any of the 10 files |
| **Build script** | `scripts/build-personas.js` | Neither `FRONTMATTER_LEDGER_VSCODE` (line ~381) nor `FRONTMATTER_STANDALONE_VSCODE` (line ~408) has an `id:` line |
| **Sync script** | `scripts/sync-personas.js` | `validateVSCodeFrontmatter()` (line ~125) checks `role`, `name`, `vs_file_name` — no `id` validation |
| **Agent registry** | `mcp-server/src/utils/agent-registry.ts` | `parseFrontmatter()` extracts only `name:` and `role:` (line ~21). Module exposes only `role → name` map via `getAgentHandle()` |
| **Handoff response builder** | `mcp-server/src/tools/workflow-handoff.ts` | `buildHandoffResponse()` (line ~162) calls `getAgentHandle()` for `agent_name`; emits `auto_handoff: { agent_name, prompt }` |
| **Handoff prompt builder** | `mcp-server/src/utils/workflow-helpers.ts` | `buildHandoffPrompt(projectPath)` (line ~78) returns only `"Project path: <path>"` — no routing prefix |
| **VS Code handoff block** | `personas/ledger/src/partials/handoff-block-vscode.md` | Instructs agents to pass `agentName` to `runSubagent` — parameter does not exist |

### Current Auto-Handoff Data Flow (Broken)

```
buildHandoffResponse()
  → nextAgentFromStatus() → role string (e.g., "Developer")
  → getAgentHandle(role) → name string (e.g., "3 - Developer v3.5.2")
  → auto_handoff: { agent_name: <name>, prompt: "Project path: <path>" }

Agent receives auto_handoff
  → persona says: pass agent_name as agentName param to runSubagent
  → runSubagent has no agentName param → agent drops it
  → subagent launches with no persona loaded
```

### Proposed Auto-Handoff Data Flow (Fixed)

```
buildHandoffResponse()
  → nextAgentFromStatus() → role string (e.g., "Developer")
  → getAgentHandle(role) → name string (e.g., "3 - Developer v3.5.2")
  → getAgentId(role) → id string (e.g., "ledger-3-dev")
  → auto_handoff: {
      agent_name: <name>,
      agent_id: <id>,
      prompt: "@ledger-3-dev\nProject path: <path>"
    }

Agent receives auto_handoff
  → persona says: pass auto_handoff.prompt as prompt to runSubagent
  → prompt starts with @ledger-3-dev → VS Code routes to persona with id: ledger-3-dev
  → subagent launches with correct persona loaded
```

## Approach / Architecture

Six coordinated changes across the persona build pipeline and the MCP server, designed so that:

1. **The MCP server handles prompt-prefix injection** — agents remain agnostic to the VS Code routing mechanism.
2. **Claude Code handoff is unaffected** — it uses its own `Task` tool and name-derivation logic.
3. **Stable `id:` fields** prevent breakage when filenames or version numbers change.

### Change 1: Add `id` field to all persona YAML metadata
Add an `id` key to all 7 ledger persona YAML files and all 10 standalone persona YAML files.
- **Ledger personas**: values follow the pattern `ledger-{vs_file_name stem}` (e.g., `ledger-3-dev` for `3-dev.agent.md`).
- **Standalone personas**: values follow the pattern `standalone-{vs_file_name stem}` (e.g., `standalone-researcher` for `researcher.agent.md`).

The `ledger-` / `standalone-` prefixes provide namespace isolation from each other and from other custom agents.

### Change 2: Add `id:` to both VS Code frontmatter templates in the build script
In `scripts/build-personas.js`, insert `id: {{id}}` into both `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE` so the build emits the `id:` field into all generated VS Code `.agent.md` files.

### Change 3: Extend the agent registry to parse and expose `id:`
In `mcp-server/src/utils/agent-registry.ts`:
- Update `parseFrontmatter()` to also extract `id:`.
- Build a second cached map: `role → id` alongside the existing `role → name`.
- Export a new `getAgentId(role): string | null` function.

### Change 4: Inject `@id` prefix into the handoff prompt
In `mcp-server/src/utils/workflow-helpers.ts`:
- Extend `buildHandoffPrompt()` signature to accept an optional `agentId` parameter.
- When `agentId` is provided, prepend `@{agentId}\n` to the prompt string.

In `mcp-server/src/tools/workflow-handoff.ts`:
- Import `getAgentId` from the registry.
- In `buildHandoffResponse()`, resolve the agent ID and pass it to `buildHandoffPrompt()`.
- Add `agent_id` to the `auto_handoff` payload for visibility/debugging.

### Change 5: Fix the VS Code handoff block partial
In `personas/ledger/src/partials/handoff-block-vscode.md`:
- Remove the incorrect `agentName` parameter instruction.
- Simplify to: pass `auto_handoff.prompt` as `prompt` and a short label as `description`.
- Add a note explaining that `@agent` routing is already embedded in the prompt by the MCP server.

### Change 6: Add `id:` validation to the sync script
In `scripts/sync-personas.js`, extend `validateVSCodeFrontmatter()` to warn when `id:` is missing from a VS Code persona file.

## Rationale

- **Server-side prefix injection** (Change 4) is preferred over teaching each persona about `@prefix` routing. This centralizes the VS Code-specific routing concern in one place and keeps agents agnostic to the mechanism. Claude Code handoff doesn't need changes at all.
- **Stable `id:` fields** (Change 1) prevent breakage when filenames or version numbers change. Auto-generated IDs from VS Code are undocumented and unstable.
- **Agent registry extension** (Change 3) is minimal — it adds a parallel map and getter without changing the existing `role → name` behavior.
- **The `ledger-` / `standalone-` prefixes** (Change 1) provide namespace isolation between persona suites and from other custom agents the user may have installed.

## Detailed Steps

1. **Add `id` to each ledger persona YAML meta file** (`personas/ledger/src/meta/`):
   - `1-planner.yaml` → add `id: ledger-1-planner`
   - `2-project-manager.yaml` → add `id: ledger-2-pm`
   - `3-developer.yaml` → add `id: ledger-3-dev`
   - `4-qa.yaml` → add `id: ledger-4-qa`
   - `5-reviewer.yaml` → add `id: ledger-5-reviewer`
   - `6-documentation.yaml` → add `id: ledger-6-docs`
   - `7-synthesis.yaml` → add `id: ledger-7-synthesis`

2. **Add `id` to each standalone persona YAML meta file** (`personas/standalone/src/meta/`):
   - `agents-md-curator.yaml` → add `id: standalone-agents-md-curator`
   - `changelog-curator.yaml` → add `id: standalone-changelog-curator`
   - `composer-curator.yaml` → add `id: standalone-composer-curator`
   - `manifest-curator.yaml` → add `id: standalone-manifest-curator`
   - `module-intent-architect.yaml` → add `id: standalone-module-intent-architect`
   - `orchestrator-runner.yaml` → add `id: standalone-orchestrator-runner`
   - `readme-curator.yaml` → add `id: standalone-readme-curator`
   - `researcher.yaml` → add `id: standalone-researcher`
   - `unit-test-auditor.yaml` → add `id: standalone-unit-test-auditor`
   - `whatsnew-curator.yaml` → add `id: standalone-whatsnew-curator`

3. **Update the build script** (`scripts/build-personas.js`):
   - In `FRONTMATTER_LEDGER_VSCODE` (line ~381), add `id: {{id}}` as the first line after `---` (before `name:`). The `id:` field should appear first in frontmatter since it's the machine-readable routing identifier.
   - In `FRONTMATTER_STANDALONE_VSCODE` (line ~408), add `id: {{id}}` in the same position (first line after `---`, before `name:`).

4. **Extend the agent registry** (`mcp-server/src/utils/agent-registry.ts`):
   - In `parseFrontmatter()` (line ~21): add an `id` field to the return type and parse `id:` frontmatter lines using the same pattern as `name:` and `role:`.
   - Add a module-level cache `agentIdMap: Record<string, string>` alongside `agentHandleMap`.
   - In `discoverAgents()`: when building `newMap`, also build an `idMap` from `role → id` for entries that have an `id:` field.
   - Export `getAgentId(role: string): string | null` that reads from `agentIdMap`.
   - Update `resetRegistry()` to also clear `agentIdMap`.

5. **Extend the handoff prompt builder** (`mcp-server/src/utils/workflow-helpers.ts`):
   - Change `buildHandoffPrompt(projectPath: string)` to `buildHandoffPrompt(projectPath: string, agentId?: string)`.
   - When `agentId` is provided, return `@${agentId}\nProject path: ${projectPath}` instead of just the project path.

6. **Wire up the handoff response builder** (`mcp-server/src/tools/workflow-handoff.ts`):
   - Import `getAgentId` from the agent registry.
   - In `buildHandoffResponse()` (line ~195 area), after resolving `agentName`, also resolve `const agentId = nextAgent ? getAgentId(nextAgent) : null`.
   - Pass `agentId ?? undefined` to `buildHandoffPrompt(projectPath, agentId ?? undefined)`.
   - Add `agent_id: agentId` to the `auto_handoff` payload object (alongside `agent_name` and `prompt`).

7. **Fix the VS Code handoff block** (`personas/ledger/src/partials/handoff-block-vscode.md`):
   - Replace the instruction that tells agents to pass `agentName` to `runSubagent`.
   - New instruction: when `auto_handoff` is present, invoke `runSubagent` with:
     - `prompt`: the value of `auto_handoff.prompt` (which already contains the `@agentId` routing prefix)
     - `description`: a short task label (e.g., "Agent handoff to [next_agent]")
   - Add a brief note: "The `@agent` routing prefix is already embedded in the prompt by the MCP server — do not add your own."

8. **Add `id:` validation to the sync script** (`scripts/sync-personas.js`):
   - In `validateVSCodeFrontmatter()` (line ~125), add a check for `fields.id` similar to the existing `fields.vs_file_name` check. Emit a warning if missing.

9. **Rebuild and verify personas**:
   - Run `node scripts/build-personas.js` and confirm all 7 ledger VS Code persona files in `personas/ledger/vs-code/` and all 10 standalone VS Code persona files in `personas/standalone/vs-code/` contain a valid `id:` frontmatter field.

10. **Run the MCP server test suite**:
    - Run `cd mcp-server && npm test` to verify agent registry and handoff changes pass existing tests.
    - **New tests needed** (see Testing Strategy below).

11. **Sync and verify deployment**:
    - Run `node scripts/sync-personas.js --target vscode` and confirm: (a) frontmatter validation passes with no warnings for `id:`, (b) deployed files contain `id:` in frontmatter.

## Dependencies

- Steps 1–3 (persona YAML + build script) must be done before step 9 (rebuild).
- Step 4 (agent registry) must be done before step 6 (handoff response builder).
- Step 5 (prompt builder) must be done before step 6 (handoff response builder).
- Steps 4–6 (MCP server changes) are independent of steps 1–3 (persona pipeline changes) and can be parallelized.
- Step 7 (handoff block partial) should be done before step 9 (rebuild) since the partial is assembled into the persona output.
- Step 8 (sync validation) should be done before step 11 (sync/verify).

## Required Components

### Modified Files

| File | Change |
|---|---|
| `personas/ledger/src/meta/1-planner.yaml` | Add `id: ledger-1-planner` |
| `personas/ledger/src/meta/2-project-manager.yaml` | Add `id: ledger-2-pm` |
| `personas/ledger/src/meta/3-developer.yaml` | Add `id: ledger-3-dev` |
| `personas/ledger/src/meta/4-qa.yaml` | Add `id: ledger-4-qa` |
| `personas/ledger/src/meta/5-reviewer.yaml` | Add `id: ledger-5-reviewer` |
| `personas/ledger/src/meta/6-documentation.yaml` | Add `id: ledger-6-docs` |
| `personas/ledger/src/meta/7-synthesis.yaml` | Add `id: ledger-7-synthesis` |
| `personas/standalone/src/meta/agents-md-curator.yaml` | Add `id: standalone-agents-md-curator` |
| `personas/standalone/src/meta/changelog-curator.yaml` | Add `id: standalone-changelog-curator` |
| `personas/standalone/src/meta/composer-curator.yaml` | Add `id: standalone-composer-curator` |
| `personas/standalone/src/meta/manifest-curator.yaml` | Add `id: standalone-manifest-curator` |
| `personas/standalone/src/meta/module-intent-architect.yaml` | Add `id: standalone-module-intent-architect` |
| `personas/standalone/src/meta/orchestrator-runner.yaml` | Add `id: standalone-orchestrator-runner` |
| `personas/standalone/src/meta/readme-curator.yaml` | Add `id: standalone-readme-curator` |
| `personas/standalone/src/meta/researcher.yaml` | Add `id: standalone-researcher` |
| `personas/standalone/src/meta/unit-test-auditor.yaml` | Add `id: standalone-unit-test-auditor` |
| `personas/standalone/src/meta/whatsnew-curator.yaml` | Add `id: standalone-whatsnew-curator` |
| `scripts/build-personas.js` | Add `id: {{id}}` to both `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE` templates |
| `scripts/sync-personas.js` | Add `id:` presence check to `validateVSCodeFrontmatter()` |
| `mcp-server/src/utils/agent-registry.ts` | Parse `id:` in frontmatter, add `agentIdMap` cache, export `getAgentId()` |
| `mcp-server/src/utils/workflow-helpers.ts` | Extend `buildHandoffPrompt()` to accept `agentId` and prepend `@{agentId}\n` |
| `mcp-server/src/tools/workflow-handoff.ts` | Import `getAgentId`, pass it to `buildHandoffPrompt()`, add `agent_id` to `auto_handoff` payload |
| `personas/ledger/src/partials/handoff-block-vscode.md` | Replace incorrect `agentName` instructions with correct `prompt`-only routing |

### New Exports

| Module | Export | Signature |
|---|---|---|
| `mcp-server/src/utils/agent-registry.ts` | `getAgentId` | `(role: string) => string \| null` |

### Manifest Documents to Update

| Document | Update |
|---|---|
| `personas/docs/agents/project-manifest/api-surface.md` | Document `id` metadata field in the persona YAML schema section |
| `personas/docs/agents/project-manifest/constraints.md` | Add `id` naming convention (`ledger-{vs_file_name stem}`) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Document `getAgentId()` export and `agent_id` field in the `auto_handoff` payload |

## Assumptions

- The `id:` frontmatter field is supported by VS Code 1.99+ as a standard `.agent.md` field. This was confirmed by external research referenced in the project brief (`docs/agents/projects/vs-code-subagent-calling.md`).
- The `@id` prompt-prefix routing works when passed through `runSubagent`'s `prompt` parameter. This should be verified with a manual end-to-end test after implementation.
- The Claude Code handoff block (`personas/ledger/src/partials/handoff-block-claude-code.md`) is unaffected — it uses its own name-derivation logic and the `Task` tool.

## Constraints

- The `id` values must be globally unique across all custom agents in a user's VS Code setup. The `ledger-` prefix mitigates collision risk.
- `id` values must be case-sensitive, contain no spaces, and be stable across version bumps.
- The `@id` prefix must appear at the very beginning of the prompt string for VS Code to recognize it as a routing directive.
- Existing tests for `buildHandoffPrompt()`, `buildHandoffResponse()`, and the agent registry must continue to pass after changes (backward compatibility).

## Out of Scope

- **Claude Code handoff changes** — Claude Code uses a different routing mechanism (`Task` tool with agent name derivation) that is unaffected by this fix.
- **Standalone persona auto-handoff routing** — Standalone personas receive `id:` fields for future-proofing and consistency, but they do not participate in the ledger auto-handoff workflow. No handoff block changes are needed for standalone personas.
- **VS Code version compatibility testing** — We assume VS Code 1.99+ supports `id:` frontmatter. Older versions are out of scope.
- **Dynamic ID generation** — IDs are static per-persona, defined in YAML source. No runtime ID generation or lookup is needed.

## Acceptance Criteria

1. All 7 generated ledger VS Code persona files (`personas/ledger/vs-code/*.agent.md`) contain a valid `id:` frontmatter field matching the pattern `ledger-{stem}`.
2. All 10 generated standalone VS Code persona files (`personas/standalone/vs-code/*.agent.md`) contain a valid `id:` frontmatter field matching the pattern `standalone-{stem}`.
3. `getAgentId(role)` returns the correct ID for all 7 ledger roles and `null` for unknown roles.
4. `buildHandoffPrompt(projectPath, agentId)` returns a string starting with `@{agentId}\n` when `agentId` is provided, and the original format when omitted.
5. The `auto_handoff` payload in `buildHandoffResponse()` includes `agent_id` and a prompt that begins with `@{agentId}\n`.
6. The VS Code handoff block partial no longer references the nonexistent `agentName` parameter.
7. `sync-personas.js --target vscode` validates `id:` presence and reports no warnings for all 17 personas (7 ledger + 10 standalone).
8. All existing MCP server tests pass without modification (backward compatibility).

## Testing Strategy

### Unit Tests (MCP Server — Vitest)

**Agent Registry** (`mcp-server/tests/utils/agent-registry.test.ts` — extend existing):
- `parseFrontmatter()` extracts `id:` when present and returns `undefined` when absent.
- `discoverAgents()` populates the `agentIdMap` when `.agent.md` files contain `id:` frontmatter.
- `getAgentId(role)` returns the correct ID for registered roles and `null` for unknown roles.

**Workflow Helpers** (`mcp-server/tests/utils/workflow-helpers.test.ts` — extend existing):
- `buildHandoffPrompt(path)` returns unchanged format (backward compatibility).
- `buildHandoffPrompt(path, 'ledger-3-dev')` returns `"@ledger-3-dev\nProject path: <path>"`.

**Workflow Handoff** (`mcp-server/tests/tools/workflow-handoff.test.ts` — extend existing):
- `buildHandoffResponse()` includes `agent_id` in the `auto_handoff` payload when the registry has IDs.
- `buildHandoffResponse()` omits `agent_id` gracefully when the registry has no IDs (backward compatibility with older persona files).

### Integration Tests

- **Build pipeline**: Run `node scripts/build-personas.js` and verify all 17 VS Code outputs (7 ledger + 10 standalone) contain `id:` in frontmatter.
- **Sync pipeline**: Run `node scripts/sync-personas.js --target vscode` and confirm zero validation warnings.
- **Manual end-to-end**: After deployment, trigger a handoff from one agent to another and verify the subagent launches with the correct persona loaded.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`id:` frontmatter field not supported by user's VS Code version** | Document minimum VS Code version requirement (1.99+). The `id:` field is inert in older versions — worst case is the old broken behavior persists. |
| **`@id` prompt prefix not recognized by VS Code** | The research documents (`vs-code-subagent-calling.md`) confirm this mechanism. Manual e2e test in acceptance criteria provides final verification. |
| **ID collisions with user's custom agents** | The `ledger-` and `standalone-` namespace prefixes make collisions unlikely. Document the prefix convention. |
| **Backward compatibility — old persona files without `id:`** | `getAgentId()` returns `null` when `id:` is absent. `buildHandoffPrompt()` falls back to the original format when `agentId` is `undefined`. The handoff partial still works — it just won't route to a persona, which is the current (broken) behavior. |
| **Build script template change breaks Claude Code output** | The `id:` line is only added to `FRONTMATTER_LEDGER_VSCODE`, not to `FRONTMATTER_LEDGER_CC`. Claude Code output is untouched. |
