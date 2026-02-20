# Plan

## Summary

Enable automatic inter-agent handoffs in the 7-stage MCP ledger workflow so that agents chain from one stage to the next via VS Code's `runSubagent` mechanism without manual user intervention. The MCP server remains the single source of truth for routing: `ledger_get_handoff_status` is extended with an `auto_handoff` object containing the exact VS Code agent name and the plan path as the only required context. Agent names are discovered at runtime by scanning `*.agent.md` files, eliminating version-drift. A depth counter is managed entirely server-side in the ledger, preventing runaway loops without any agent cooperation. Human override is supported at global, per-transition, and runtime levels.

## Approach / Architecture

**Pattern: MCP-Driven Routing with Runtime Agent Discovery (Hybrid Approach A from the research).**

The architecture has four pillars:

1. **Agent Registry** — A new module (`src/utils/agent-registry.ts`) scans a configured directory of `*.agent.md` files at startup, parses YAML frontmatter for `name:` and a new `role:` field, and builds an in-memory `AGENT_HANDLE_MAP: Record<string, string>` mapping internal role names (e.g., `"Developer"`) to VS Code agent handles (e.g., `"3 - Developer v3.1.2"`).

2. **Extended Handoff Response** — `buildHandoffResponse()` in `workflow.ts` gains an optional `auto_handoff` block in its JSON output when the next agent is known and the transition is eligible. The block contains `agent_name` (from the registry) and `prompt` (containing only the plan path — the receiving agent's persona already contains all workflow instructions).

3. **Ledger-Managed Depth Counter** — The root index gains an `auto_handoff_depth` field (default `0`). The MCP server increments it each time it emits an `auto_handoff` block and checks it against `MAX_HANDOFF_DEPTH` before allowing auto-handoff. This is entirely server-side — no agent cooperation is required for depth tracking—making it deterministic and immune to LLM parsing errors.

4. **Persona Instruction** — Each persona (agents 2–7) gets one paragraph instructing it to check for `auto_handoff` in the handoff response and invoke `runSubagent` if present, otherwise fall back to the manual handoff block.

```
Developer completes work
  → calls ledger_get_handoff_status
  → MCP increments auto_handoff_depth in ledger (e.g. 2 → 3), checks < MAX
  → MCP returns { ..., auto_handoff: { agent_name: "4 - QA v3.1.2", prompt: "Project path: /path/to/plan" } }
  → Developer calls runSubagent(agentName="4 - QA v3.1.2", prompt="Project path: /path/to/plan")
  → QA starts, loads tools via persona instructions, processes WPs, calls ledger_get_handoff_status
  → chain continues until COMPLETE or depth limit
```

## Rationale

- **Single source of truth preserved.** All routing logic stays in the MCP server. Personas contain zero routing knowledge — they just follow the server's instruction.
- **Minimal handoff context.** The only data passed to the next agent is the plan path. Every agent's persona already contains its full workflow instructions — tool loading, `get_next_action` calls, handoff protocol. Duplicating these in a bootstrap prompt would create divergence risk.
- **Deterministic depth tracking.** The depth counter lives in the ledger, managed entirely by the MCP server. No agent needs to parse, increment, or forward a depth value. This eliminates the fragile dependency on LLMs correctly handling numeric state across a chain of 7+ handoffs.
- **Runtime agent discovery eliminates version drift.** When a persona is bumped from `v3.1.2` → `v3.2.0`, the MCP server picks up the new name at next startup. No manual map sync required.
- **Granular human override.** Auto-handoff can be disabled globally (config flag), per-transition (blocklist), or at runtime (depth limit / BLOCKED status). The Planner → PM transition remains manual by design (no ledger exists yet).
- **Minimal persona changes.** One instruction paragraph per file, no hardcoded agent names, no routing conditionals.
- **Backward-compatible.** If the `auto_handoff` field is absent (e.g., agents_dir not configured, or a blocklisted transition), agents fall back to the existing manual handoff block. The new `role:` frontmatter field and `auto_handoff_depth` ledger field are additive and do not break existing behavior.

## Detailed Steps

### Step 1: Add `role:` field to persona frontmatter

Add a `role:` field to each of the 7 `*.agent.md` persona files under `personas/ledger/`. The value must exactly match the corresponding entry in the `AGENT_ROLES` constant in `workflow.ts`.

| File | `role:` value |
|------|---------------|
| `1-planner.md` | `Planner` |
| `2-project-manager.md` | `Project Manager` |
| `3-developer.md` | `Developer` |
| `4-qa.md` | `QA` |
| `5-reviewer.md` | `Reviewer` |
| `6-documentation.md` | `Documentation` |
| `7-synthesis.md` | `Synthesis` |

The `role:` field is placed in the YAML frontmatter alongside the existing `name:`, `description:`, and `tools:` fields.

### Step 2: Create the Agent Registry module

Create a new file `src/utils/agent-registry.ts` with the following responsibilities:

- **`discoverAgents(agentsDir: string): Record<string, string>`** — Scans `agentsDir` for `*.agent.md` files, reads each file, extracts YAML frontmatter (the block between the first `---` and the second `---`), parses the `name:` and `role:` fields. Files without a `role:` field are silently ignored (e.g., standalone agents like Researcher). Returns `AGENT_HANDLE_MAP` mapping role → VS Code agent name.
- **`getAgentHandle(role: string): string | null`** — Looks up a role in the cached map. Returns `null` if not found.
- **`isRegistryLoaded(): boolean`** — Returns whether the agent registry has been populated.

Implementation notes:
- Parse frontmatter manually (split on `---` delimiters, parse YAML-like `key: value` lines) to avoid adding a YAML parsing dependency. The frontmatter structure is simple and well-controlled.
- The module caches the map in a module-level variable. Discovery runs once on first access (lazy initialization) or can be explicitly triggered.
- Log warnings to stderr for files that have a `role:` field but no `name:` field, or role values that don't match any known `AGENT_ROLES` entry.

### Step 3: Accept `agents_dir` configuration parameter

Extend the MCP server startup in `src/index.ts` to accept an `agents_dir` parameter. This is the absolute path to the directory containing `*.agent.md` files (the VS Code User prompts folder).

- Accept it as a CLI argument (e.g., `--agents-dir /path/to/prompts`) or via the `args` array in `.mcp.json`.
- If not provided, attempt platform-specific auto-detection:
  - macOS: `~/Library/Application Support/Code/User/prompts/`
  - Linux: `~/.config/Code/User/prompts/`
  - Windows: `%APPDATA%/Code/User/prompts/`
- If the directory does not exist or contains no `*.agent.md` files, log a warning to stderr and continue with auto-handoff disabled (the registry remains empty, `auto_handoff` is never emitted).
- Pass the resolved path to `agent-registry.ts` for discovery.

### Step 4: Add `buildHandoffPrompt()` function

Add a new function to `src/tools/workflow.ts`:

```typescript
function buildHandoffPrompt(projectPath: string): string
```

The prompt returns only the plan path:

```
Project path: /absolute/path/to/plan
```

This is intentionally minimal. The receiving agent's persona (loaded automatically by VS Code from its `*.agent.md` file) already contains all workflow instructions — MCP tool loading, `get_next_action` calls, the handoff protocol, and the auto-handoff continuation rule. Duplicating those instructions in the prompt would create divergence risk between persona and prompt.

Define `MAX_HANDOFF_DEPTH = 10` as a module-level constant (used by the depth-check logic in Step 5, not by this function).

### Step 5: Extend `buildHandoffResponse()` with `auto_handoff`

Modify the existing `buildHandoffResponse()` function in `src/tools/workflow.ts`:

- Add one new optional parameter: `projectPath?: string`.
- After constructing the base payload, check whether auto-handoff should be included:
  - The agent registry is loaded and has a handle for the computed `nextAgent`
  - `projectPath` is provided
  - Status is not `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`
  - The current `auto_handoff_depth` in the ledger is `< MAX_HANDOFF_DEPTH` (read from the root index, which is already loaded by the caller)
  - The transition is not in a configurable blocklist (initially empty)
- If all checks pass:
  1. Increment `auto_handoff_depth` in the root index and persist it.
  2. Add `auto_handoff: { agent_name, prompt }` to the payload, where `prompt` is `buildHandoffPrompt(projectPath)` (plan path only).
- If any check fails, omit `auto_handoff` — the agent falls back to manual routing.

Note: the depth increment happens atomically with the handoff emission. If the same `getHandoffStatus` is called again (e.g., agent retries), the depth has already been incremented, which is the correct behavior — each emission counts as a handoff attempt.

### Step 6: Add `auto_handoff_depth` to ledger schema and thread `projectPath` through callers

Two sub-tasks:

**6a. Extend the ledger schema.** Add an optional `auto_handoff_depth` field to `RootIndex` in `src/schema/root-index.ts`:

```typescript
auto_handoff_depth?: number; // default 0, managed by the server
```

This field is incremented by the server each time it emits an `auto_handoff` block, and reset to `0` when:
- The project status reaches `COMPLETE` (in `getHandoffStatus` for Synthesis)
- The project is re-initialized via `ledger_initialize_project`
- A manual override resets it (future enhancement, out of scope)

The field is backward-compatible: if absent, it defaults to `0`. Existing ledger files continue to work without migration.

**6b. Thread `projectPath` through handoff callers.** Update `getHandoffStatus()` and each agent-specific handoff function (`getProjectManagerHandoff`, `getDeveloperHandoff`, `getQaHandoff`, `getReviewerHandoff`, `getDocumentationHandoff`) to:
- Accept `projectPath` and `store` (LedgerStore) as parameters
- Pass `projectPath` through to `buildHandoffResponse()`
- `buildHandoffResponse` reads `auto_handoff_depth` from the root index via the store

No new parameters are added to `GetHandoffStatusSchema`. The depth is entirely server-managed — agents never see or interact with it.

### Step 7: Add auto-handoff instruction to persona files

Add the following paragraph to the **Workflow** section of each persona file (agents 2–7, i.e., `2-project-manager.md` through `7-synthesis.md`). The Planner (agent 1) is excluded because no ledger exists at that point.

> **Automatic Handoff:** After calling `ledger_get_handoff_status`, check the response for an `auto_handoff` object. If present, invoke `runSubagent` with `agentName` set to `auto_handoff.agent_name` and `prompt` set to `auto_handoff.prompt`. If `auto_handoff` is absent, end your turn with the standard CURRENT AGENT / NEXT AGENT / STATUS block for manual routing by the user.

No additional depth-related instructions are needed. The depth counter is managed entirely by the MCP server in the ledger — agents do not need to parse, track, or forward it.

### Step 8: Write unit tests for the agent registry

Create `tests/utils/agent-registry.test.ts` with tests for:

- **Happy path:** A temp directory with 3 mock `*.agent.md` files (with valid frontmatter including `role:` and `name:`) → correct `AGENT_HANDLE_MAP` built.
- **Missing `role:` field:** File is silently skipped, no entry in the map.
- **Missing `name:` field with `role:` present:** Warning logged, file skipped.
- **Empty directory:** Returns empty map.
- **Non-existent directory:** Throws or returns empty map with warning.
- **Duplicate `role:` values:** Last-wins or error (decide during implementation — last-wins is simpler).
- **Non-`.agent.md` files ignored:** `.md` files without `.agent.md` suffix are skipped.

### Step 9: Write unit tests for auto-handoff in handoff response

Extend `tests/tools/workflow-handoff.test.ts` with tests for:

- **`auto_handoff` present:** When registry is loaded, status is `READY_FOR_QA`, projectPath is valid and depth < MAX → response contains `auto_handoff` with correct `agent_name` and `prompt` (plan path only).
- **`auto_handoff` absent — terminal status:** Status is `COMPLETE` → no `auto_handoff`.
- **`auto_handoff` absent — BLOCKED:** Status is `BLOCKED` → no `auto_handoff`.
- **`auto_handoff` absent — IN_PROGRESS:** Status is `IN_PROGRESS` → no `auto_handoff`.
- **`auto_handoff` absent — depth exceeded:** `auto_handoff_depth >= MAX_HANDOFF_DEPTH` in ledger → no `auto_handoff`.
- **`auto_handoff` absent — registry empty:** No agent files discovered → no `auto_handoff`.
- **`auto_handoff` absent — no projectPath:** projectPath is undefined → no `auto_handoff`.
- **Depth increment:** Verify `auto_handoff_depth` in the ledger is incremented when `auto_handoff` is emitted.
- **Depth reset:** Verify `auto_handoff_depth` is reset to 0 on project completion.
- **Rework loop:** QA FAIL → Developer rework → `auto_handoff` present for Developer (depth permits).
- **`buildHandoffPrompt` output:** Verify prompt contains only the project path.

### Step 10: Write integration test for full auto-handoff chain

Extend `tests/integration/full-workflow.test.ts` (or create a new `tests/integration/auto-handoff.test.ts`) to test:

- Set up a mock agents directory with persona files.
- Initialize a project, create WPs, run pipelines through PM → Developer → QA → Reviewer → Documentation → Synthesis.
- At each transition, call `getHandoffStatus` and verify the `auto_handoff` field chains correctly to the next agent.
- Verify `auto_handoff_depth` in the ledger increments at each transition (0 → 1 → 2 → ... → 5).
- Verify the chain terminates at Synthesis with no `auto_handoff` (status COMPLETE) and depth is reset to 0.
- Verify depth limit enforcement: set `auto_handoff_depth` to MAX in the ledger and confirm `auto_handoff` is omitted.

### Step 11: Update `sync-personas.js` to sync `role:` field

While `sync-personas.js` does not need to generate the agent handle map (runtime discovery handles this), it should be updated to:

- Validate that every persona file with a `role:` field in `personas/ledger/` also has a matching `name:` field.
- Emit a warning if a ledger persona is missing the `role:` field (to catch omissions during persona authoring).

This is a minor enhancement to the existing sync validation logic.

## Dependencies

- The `*.agent.md` files must be deployed to the VS Code prompts directory (already handled by `sync-personas.js`).
- The `agents_dir` path must be resolvable at MCP server startup — either explicitly configured or auto-detected.
- No new npm dependencies required. Frontmatter parsing uses simple string splitting.

## Required Components

- [src/utils/agent-registry.ts](../../../../src/utils/agent-registry.ts) — **New file.** Agent discovery and handle map.
- [src/utils/pipeline-maps.ts](../../../../src/utils/pipeline-maps.ts) — **No changes.** The `AGENT_HANDLE_MAP` is built dynamically by the registry, not hardcoded here.
- [src/schema/root-index.ts](../../../../src/schema/root-index.ts) — **Modified.** Add optional `auto_handoff_depth` field to `RootIndex` type.
- [src/tools/workflow.ts](../../../../src/tools/workflow.ts) — **Modified.** `buildHandoffResponse()` extended with `auto_handoff`; new `buildHandoffPrompt()` (plan-path-only) and `MAX_HANDOFF_DEPTH` constant; depth read from and incremented in the ledger.
- [src/index.ts](../../../../src/index.ts) — **Modified.** Accept `agents_dir` parameter; initialize agent registry at startup.
- [personas/ledger/1-planner.md](../../../../../../personas/ledger/1-planner.md) — **Modified.** Add `role: Planner` to frontmatter (no workflow instruction change).
- [personas/ledger/2-project-manager.md](../../../../../../personas/ledger/2-project-manager.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [personas/ledger/3-developer.md](../../../../../../personas/ledger/3-developer.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [personas/ledger/4-qa.md](../../../../../../personas/ledger/4-qa.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [personas/ledger/5-reviewer.md](../../../../../../personas/ledger/5-reviewer.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [personas/ledger/6-documentation.md](../../../../../../personas/ledger/6-documentation.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [personas/ledger/7-synthesis.md](../../../../../../personas/ledger/7-synthesis.md) — **Modified.** Add `role:` to frontmatter + auto-handoff workflow instruction.
- [tests/utils/agent-registry.test.ts](../../../../tests/utils/agent-registry.test.ts) — **New file.** Unit tests for agent registry.
- [tests/tools/workflow-handoff.test.ts](../../../../tests/tools/workflow-handoff.test.ts) — **Modified.** Extended with auto-handoff tests.
- [sync-personas.js](../../../../../../sync-personas.js) — **Modified.** Add `role:` field validation.

## Assumptions

- VS Code's `runSubagent` tool continues to accept `agentName` (exact name match) and `prompt` (free text) as parameters. The tool is synchronous and stateless.
- The `*.agent.md` frontmatter format remains stable: YAML between `---` delimiters at the top of the file, with `name:` as a quoted string on a single line.
- The `role:` frontmatter field will not conflict with any existing or planned VS Code agent configuration keys.
- Agents have the `agent` tool type in their `tools:` frontmatter, granting them access to `runSubagent`.
- The MCP server runs on the same machine as VS Code and can read the prompts directory at startup.
- A single full pipeline pass (7 agents) plus a few rework cycles fits within `MAX_HANDOFF_DEPTH = 10`. The server manages this counter deterministically.

## Constraints

- **Minimal ledger schema addition.** A single optional `auto_handoff_depth` field is added to `root-index.json`. It defaults to `0` if absent, requiring no migration of existing ledger files.
- **No new npm dependencies.** YAML frontmatter is parsed with string operations.
- **Backward compatibility.** If `agents_dir` is not configured or the registry is empty, the system behaves identically to today (manual handoffs only). The `auto_handoff_depth` field is ignored when auto-handoff is disabled.
- **Planner excluded from auto-handoff.** The Planner → PM transition remains manual because no ledger exists yet when the Planner runs.

## Out of Scope

- **Orchestrator agent pattern.** Rejected in the research as over-engineered for a linear pipeline.
- **Token/cost budgeting.** VS Code may impose its own limits; this plan does not add a token budget mechanism.
- **Subagent result inspection.** The calling agent fire-and-forgets via `runSubagent`. Whether/how the user sees subagent errors is a VS Code platform concern, not an MCP concern.
- **Removing the manual handoff block.** It remains as the fallback path. Removing it would be a separate follow-up.
- **Version-less agent names.** A separate decision on whether to drop version numbers from agent `name:` fields.
- **Persistent handoff audit trail.** The `auto_handoff_depth` counter provides basic chain-length observability. A richer audit log (e.g., logging each handoff transition as a project comment with timestamps) is a potential enhancement but not in scope for this plan.
- **`sync-personas.js` auto-generating the `AGENT_HANDLE_MAP`.** Runtime discovery makes this unnecessary.

## Acceptance Criteria

- Calling `ledger_get_handoff_status` with a valid `project_path` and a forward transition status (e.g., `READY_FOR_QA`) returns a response containing `auto_handoff.agent_name` and `auto_handoff.prompt` when the agent registry is loaded.
- The `auto_handoff.agent_name` matches the `name:` field from the corresponding `*.agent.md` file exactly.
- The `auto_handoff.prompt` contains only the project path (no bootstrap instructions, no depth value).
- `auto_handoff` is omitted when: status is `COMPLETE`, `BLOCKED`, or `IN_PROGRESS`; `auto_handoff_depth` in the ledger >= `MAX_HANDOFF_DEPTH`; registry is not loaded; projectPath is not provided.
- The `auto_handoff_depth` field in the ledger is incremented each time an `auto_handoff` block is emitted.
- The `auto_handoff_depth` field is reset to `0` when the project reaches `COMPLETE` status.
- No `handoff_depth` parameter exists on `GetHandoffStatusSchema` — depth is managed entirely server-side.
- All 7 persona files under `personas/ledger/` have a `role:` field in their frontmatter matching the expected workflow role.
- Personas 2–7 contain the auto-handoff instruction paragraph in their Workflow section.
- `agent-registry.ts` correctly discovers agent handles from a directory of `*.agent.md` files, ignoring files without a `role:` field.
- All new and modified code has corresponding passing unit tests.
- The existing test suite (`vitest run`) passes without regressions.
- When `agents_dir` is not configured, the server starts without errors and auto-handoff is silently disabled.

## Testing Strategy

### Unit Tests

- **`agent-registry.test.ts`**: Test discovery with various directory states (happy path, missing fields, empty dir, non-existent dir, duplicates, non-agent files). Use temp directories with mock `*.agent.md` files.
- **`workflow-handoff.test.ts` (extended)**: Test `buildHandoffResponse` with and without registry, verify `auto_handoff` presence/absence for all status types, test ledger-based depth limit, verify depth increment/reset behavior, test `buildHandoffPrompt` returns plan-path-only output.

### Integration Tests

- **`auto-handoff.test.ts` or extended `full-workflow.test.ts`**: Set up mock agents directory, run a multi-step workflow, verify `auto_handoff` chains correctly from PM through to Synthesis, verify terminal state has no `auto_handoff`, verify depth limit cuts the chain.

### Manual Validation

- After implementation, run `sync-personas.js` to deploy updated personas.
- Start a small project (1–2 WPs) and invoke the Planner manually.
- Hand off to PM manually (Planner is excluded from auto-handoff).
- Verify that PM → Developer → QA → Reviewer → Documentation → Synthesis chains automatically via `runSubagent`.
- Verify the chain terminates at Synthesis with a manual handoff block (status COMPLETE).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Runaway handoff loops** (QA FAIL → Developer → QA FAIL → ...) | `MAX_HANDOFF_DEPTH = 10` enforced server-side via `auto_handoff_depth` in the ledger. The counter is incremented deterministically by the MCP server — no agent cooperation required. When exceeded, `auto_handoff` is omitted and the agent falls back to manual routing. |
| **Agent name mismatch** (registry returns a name that doesn't match any VS Code agent) | Runtime discovery reads directly from `*.agent.md` frontmatter — the name is always current. If the prompts directory is stale (pre-sync), `sync-personas.js` should be run first. |
| **Frontmatter parsing fragility** (edge cases in YAML parsing) | Use minimal, line-based parsing for `name:` and `role:` fields only. The frontmatter format is tightly controlled and simple. Extensive unit tests for edge cases. |
| **Subagent context loss** (the next agent starts without prior conversation context) | The handoff prompt contains only the plan path. The receiving agent's persona (loaded from its `*.agent.md` file) contains all workflow instructions. The MCP ledger provides full project state. This is actually simpler and more reliable than the current manual workflow — no risk of the user forgetting to paste context. |
| **`agents_dir` path incorrect or inaccessible** | Auto-detect platform-specific defaults; log a clear warning if dir is missing or empty; degrade gracefully to manual handoffs. |
| **Token budget exhaustion** during a long automated chain | Depth limit acts as an indirect token cap. A full 7-stage run at ~10k tokens per agent ≈ 70k tokens — well within typical limits. If a concern, `MAX_HANDOFF_DEPTH` can be lowered. |
| **Breaking existing tests** during `buildHandoffResponse` signature change | The new parameter (`projectPath`) is optional with a default. All existing call sites continue to work without modification until explicitly updated. The `auto_handoff_depth` field in the schema defaults to `0` when absent, so existing ledger files need no migration. |
