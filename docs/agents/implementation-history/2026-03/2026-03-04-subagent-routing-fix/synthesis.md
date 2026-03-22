# Synthesis — Subagent Routing Fix

**Project:** `2026-03-04-subagent-routing-fix`
**Completed:** 2026-03-04
**Status:** COMPLETE — all 8 work packages delivered

---

## Problem Solved

VS Code subagent routing was broken in the ledger persona handoff workflow. When a completing agent called `runSubagent` to hand off to the next agent, the target agent's persona was never loaded. There were three compounding root causes:

1. **`runSubagent` has no `agentName` parameter** — the handoff block partial was instructing agents to pass a parameter that does not exist.
2. **`.agent.md` files lacked `id:` frontmatter** — VS Code auto-generates unstable IDs from file hashes, so any routing attempt based on identity was fragile.
3. **The handoff prompt contained no routing directive** — even if routing had worked, the prompt sent to the subagent was only `"Project path: <path>"` with no `@id` prefix to select the target persona.

The effect: every automated handoff launched a subagent with no persona loaded, causing the receiving agent to operate without workflow context, tools, or role identity.

---

## What Was Delivered

### Stable `id:` Fields (WP-001)

Added a stable `id` key to all 17 persona YAML source files:

- **7 ledger personas** (`personas/ledger/src/meta/`) using the pattern `ledger-{vs_file_name stem}`:
  `ledger-1-planner`, `ledger-2-pm`, `ledger-3-dev`, `ledger-4-qa`, `ledger-5-reviewer`, `ledger-6-docs`, `ledger-7-synthesis`

- **10 standalone personas** (`personas/standalone/src/meta/`) using `standalone-{vs_file_name stem}`:
  `standalone-agents-md-curator`, `standalone-changelog-curator`, `standalone-composer-curator`, `standalone-manifest-curator`, `standalone-module-intent-architect`, `standalone-orchestrator-runner`, `standalone-readme-curator`, `standalone-researcher`, `standalone-unit-test-auditor`, `standalone-whatsnew-curator`

`id` values are lowercase, contain no spaces, and are intentionally stable across version bumps and renames. The `ledger-` and `standalone-` namespace prefixes prevent collisions with other custom agents the user may have installed.

### Build Script — `id:` in VS Code Frontmatter Templates (WP-002)

Updated `scripts/build-personas.js` to include `id: {{id}}` as the first field in both `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE` templates. The Claude Code frontmatter templates (`FRONTMATTER_LEDGER_CC`, `FRONTMATTER_STANDALONE_CC`) were intentionally left unchanged — Claude Code uses name-derivation routing, not `@id` routing.

### Handoff Block Partial — Corrected `runSubagent` Instructions (WP-003)

Rewrote `personas/ledger/src/partials/handoff-block-vscode.md` to:
- Remove the incorrect `agentName` parameter instruction (the parameter does not exist in `runSubagent`).
- Instruct agents to pass `auto_handoff.prompt` as the `prompt` parameter and a short label as `description`.
- Add a note that the `@agent` routing prefix is already embedded in the prompt by the MCP server — agents must not add their own.

### Agent Registry — `getAgentId()` (WP-004)

Extended `mcp-server/src/utils/agent-registry.ts`:
- `parseFrontmatter()` now extracts `id:` alongside `name:` and `role:`.
- `discoverAgents()` builds a parallel `agentIdMap: Record<string, string>` (role → id) from scanned `.agent.md` files.
- New export: `getAgentId(role: string): string | null` — returns the registered `id` for a role, or `null` if no `.agent.md` with that role + `id` has been scanned.
- `resetRegistry()` clears `agentIdMap` alongside `agentHandleMap`.

### Handoff Pipeline — `@id` Prompt Prefix Injection (WP-005)

Extended two files:

**`mcp-server/src/utils/workflow-helpers.ts`**
- `buildHandoffPrompt(projectPath: string, agentId?: string): string` — when `agentId` is provided, returns `@{agentId}\nProject path: ${projectPath}`; otherwise returns the original `Project path: ${projectPath}`. Backward compatible.

**`mcp-server/src/tools/workflow-handoff.ts`**
- `buildHandoffResponse()` now calls `getAgentId(nextAgent)` after resolving `agentName`.
- Passes `agentId ?? undefined` to `buildHandoffPrompt()`.
- Includes `agent_id` in the `auto_handoff` payload (omitted — not set to `null` — when no ID is available).

The MCP server now handles the entire VS Code routing concern. Agents remain agnostic to `@id` syntax and routing mechanics.

### Sync Script — `id:` Validation (WP-006)

Extended `scripts/sync-personas.js`:
- `validateVSCodeFrontmatter()` now emits a warning when `id:` is missing from a ledger VS Code persona.
- `validateStandaloneVSCodeFrontmatter()` similarly warns when `id:` is absent from a standalone VS Code persona.
- Both validations are advisory (non-blocking), consistent with the existing `role` and `vs_file_name` checks.

### Integration Verification (WP-007)

All acceptance criteria verified:

| Check | Result |
|-------|--------|
| `npm test` in `mcp-server/` | ✓ 1004 tests, 0 failures (33 test files) |
| 7 ledger VS Code `.agent.md` files contain `id:` | ✓ All 7 verified |
| 10 standalone VS Code `.agent.md` files contain `id:` | ✓ All 10 verified |
| Claude Code persona files have no `id:` | ✓ Confirmed absent |
| `sync-personas.js --target vscode` — zero `id:` warnings | ✓ Zero warnings, all 17 files validated |
| `build-personas.js --check` reports no stale output | ✓ All 14 ledger outputs up-to-date |
| Handoff block references `auto_handoff.prompt`, not `agentName` | ✓ Confirmed |

### Manifest Documentation (WP-008)

Updated six manifest documents across two sub-projects:

**`personas/docs/agents/project-manifest/`**
- `api-surface.md` — `id` field added to the Ledger Per-Persona YAML schema table and the Standalone Per-Persona YAML table. Both VS Code frontmatter template listings (`FRONTMATTER_LEDGER_VSCODE`, `FRONTMATTER_STANDALONE_VSCODE`) updated to show `id: {{id}}`. `validateVSCodeFrontmatter` and `validateStandaloneVSCodeFrontmatter` descriptions updated to include `id:` validation.
- `constraints.md` — Rule 25b added: `id` naming conventions, format constraints, stability requirement, uniqueness requirement, and note that Claude Code output is unaffected.

**`mcp-server/docs/agents/project-manifest/`**
- `api-surface.md` — `getAgentId(role: string): string | null` documented in the Agent Registry section. `buildHandoffPrompt()` signature updated to `(projectPath: string, agentId?: string): string`. `auto_handoff` payload shape updated to include `agent_id?: string` and note on `@{agent_id}\n` prompt prefix. `HandoffStatusPayload.auto_handoff` type block updated with `agent_id` field.
- `file-tree.md` — `agent-registry.ts` exports updated to list `getAgentId`.
- `constraints.md` — Test guideline added for new agent registry tests.
- `workflow-specification/auxiliary-systems.md` — Updated auto-handoff pseudocode to show `getAgentId()` call and `agent_id` inclusion in both response payload and prompt construction.

---

## Architectural Decisions

**Server-side prefix injection was chosen over agent-side prefix.** Teaching each persona about `@id` routing would have scattered VS Code-specific knowledge across 6 persona content templates. Centralising this in `buildHandoffPrompt()` means the routing mechanism is a single-point concern: if VS Code changes how `@id` routing works, only one function needs to change.

**`agent_id` is omitted (not null) from the payload when absent.** This preserves backward compatibility with older persona files that lack `id:` frontmatter. The handoff block still functions — the subagent just launches without persona routing (the current broken behavior becomes the graceful fallback instead of an unhandled case).

**The `@id` prefix must appear at the very beginning of the prompt string.** VS Code requires this to recognize it as a routing directive. `buildHandoffPrompt()` enforces this by prepending `@{agentId}\n` before the project path line.

**Standalone personas received `id:` fields for future-proofing** despite not participating in the ledger auto-handoff workflow. This ensures consistency and allows standalone personas to be invoked via `@id` routing if needed in the future. No handoff block changes were made for standalone personas — out of scope.

---

## Files Changed

| File | Change |
|------|--------|
| `personas/ledger/src/meta/1-planner.yaml` through `7-synthesis.yaml` (7 files) | Added `id:` field |
| `personas/standalone/src/meta/*.yaml` (10 files) | Added `id:` field |
| `scripts/build-personas.js` | Added `id: {{id}}` to `FRONTMATTER_LEDGER_VSCODE` and `FRONTMATTER_STANDALONE_VSCODE` |
| `personas/ledger/src/partials/handoff-block-vscode.md` | Replaced `agentName` instruction with `auto_handoff.prompt` instruction |
| `mcp-server/src/utils/agent-registry.ts` | Added `id` parsing, `agentIdMap`, `getAgentId()` export, `resetRegistry()` update |
| `mcp-server/tests/utils/agent-registry.test.ts` | New tests for `id` parsing and `getAgentId()` |
| `mcp-server/src/utils/workflow-helpers.ts` | Extended `buildHandoffPrompt()` with optional `agentId` parameter |
| `mcp-server/src/tools/workflow-handoff.ts` | Import `getAgentId`, pass to `buildHandoffPrompt`, add `agent_id` to payload |
| `mcp-server/tests/utils/workflow-helpers.test.ts` | New tests for `buildHandoffPrompt()` with/without `agentId` |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | New tests for `agent_id` in `auto_handoff` payload |
| `scripts/sync-personas.js` | Added `id:` presence check to both VS Code frontmatter validators |
| `personas/docs/agents/project-manifest/api-surface.md` | `id` field in YAML schemas, frontmatter templates, validator descriptions |
| `personas/docs/agents/project-manifest/constraints.md` | Rule 25b: `id` naming conventions |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | `getAgentId()`, updated `buildHandoffPrompt()` signature, `agent_id` payload |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | `getAgentId` in agent-registry exports |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Test guideline |
| `mcp-server/docs/agents/project-manifest/workflow-specification/auxiliary-systems.md` | Auto-handoff pseudocode updated |

---

## New Exports

| Module | Export | Signature |
|--------|--------|-----------|
| `mcp-server/src/utils/agent-registry.ts` | `getAgentId` | `(role: string) => string \| null` |

---

## Outcome

VS Code subagent routing is now functional. The complete fix chain is:

1. Persona YAML source files define stable `id` values.  
2. Build script emits `id:` frontmatter into all VS Code `.agent.md` files.  
3. Sync deploys `.agent.md` files to the VS Code prompts directory — VS Code reads `id:` and registers the persona under that ID.  
4. MCP server's agent registry scans deployed files and maps `role → id`.  
5. On project handoff, `buildHandoffResponse()` calls `getAgentId()` and passes the ID to `buildHandoffPrompt()`, which prepends `@{agentId}\n` to the prompt.  
6. The `auto_handoff.prompt` field delivered to the completing agent already contains the routing directive.  
7. The corrected handoff block tells agents to pass `auto_handoff.prompt` directly to `runSubagent` without modification.  
8. VS Code reads the `@id` prefix from the prompt, identifies the matching `.agent.md` file, and loads it as the subagent's persona.

The result: handoffs now reliably route to the correct persona. Agents receive full workflow context, tool permissions, and role identity on every automated handoff.
