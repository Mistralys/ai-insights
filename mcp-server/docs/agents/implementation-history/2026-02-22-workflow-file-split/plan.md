# Plan

## Summary

The MCP server's `src/tools/workflow.ts` has grown to **1,990 lines** — nearly 3× the largest other tool file — and now hosts three conceptually distinct tools plus a substantial shared-helper layer. A secondary candidate is `src/tools/help.ts` at 614 lines, which is bloated almost entirely by inlined documentation strings. This plan describes how to split both files into smaller, purpose-focused modules without changing any externally observable behaviour — tool registrations, MCP responses, test coverage, and the exported public API must all remain identical after the refactor.

---

## Architectural Context

### File size landscape (src/ only)

| File | Lines | Verdict |
|------|-------|---------|
| `tools/workflow.ts` | 1,990 | **Critical — split required** |
| `tools/work-package.ts` | 675 | Borderline — monitor |
| `tools/help.ts` | 614 | **Secondary — content extraction needed** |
| `tools/pipeline.ts` | 519 | Acceptable |
| `storage/ledger-store.ts` | 380 | Acceptable |
| `tools/project-lifecycle.ts` | 349 | Acceptable |

### Current `workflow.ts` internal structure

The file contains six distinct logical layers, currently merged into one file:

| Layer | Approx. lines | Description |
|-------|---------------|-------------|
| **Shared constants & display maps** | 1–65 | `STALE_PIPELINE_HOURS`, `MAX_HANDOFF_DEPTH`, `buildHandoffPrompt()`, `agentNameMap`, `actionNameMap`, `reworkActionMap`, `pipelineAgentRoleMap` |
| **Batch-step builder** | 66–160 | `buildBatchNextSteps()` — next-step arrays for the batch tool |
| **Shared pipeline helpers** | 161–230 | `isStalePipeline()`, `extractStalePipelineAction()`, `extractReworkAction()`, `isMostRecentPipelineFail()`, `getHandoffNotesForAgent()`, `hasDependencyBlocked()`, `isBlockedByDependencies()` |
| **`ledger_get_next_action` tool** | 231–825 | `GetNextActionSchema`, `getNextAction()`, and five per-agent action functions |
| **`ledger_get_handoff_status` tool** | 826–1,700 | `GetHandoffStatusSchema`, `getHandoffStatus()`, `nextAgentFromStatus()`, `buildHandoffResponse()`, and five per-agent handoff functions |
| **`ledger_get_next_actions` tool** | 1,701–1,990 | `GetNextActionsSchema`, `getNextActions()`, then `register()` |

### Key integration points

- **`src/index.ts`** imports `* as workflowTools from './tools/workflow.js'` and calls `workflowTools.register(server)`. This import must continue to work unchanged.
- **`tests/tools/workflow-handoff.test.ts`** (1,333 lines) does `import * as _internal from '../../src/tools/workflow.js'` and destructures ~14 named exports. These imports must be updated to import from the correct new modules.
- **`utils/pipeline-maps.ts`** is already extracted — `workflow.ts` imports routing constants from it. The same "extract shared code" pattern applies here.
- Existing test file `tests/tools/workflow-handoff.test.ts` covers both `get_next_action` and `get_handoff_status` logic. No new test files are strictly required, but moving to per-module test files would align with the codebase convention.

---

## Approach / Architecture

Split `workflow.ts` into **four focused files** and reduce `workflow.ts` to a thin aggregator. Separately, extract the inlined documentation strings from `help.ts` into a sibling content file.

### New file layout after the split

```
src/
  tools/
    workflow.ts                   ← thin aggregator: imports + register() only
    workflow-next-action.ts       ← NEW: ledger_get_next_action tool
    workflow-handoff.ts           ← NEW: ledger_get_handoff_status tool + buildHandoffResponse
    workflow-batch-actions.ts     ← NEW: ledger_get_next_actions tool
    help.ts                       ← trimmed: schema, handler, register()
    help-content.ts               ← NEW: TOOL_HELP record and all static strings
  utils/
    workflow-helpers.ts           ← NEW: shared constants and pipeline-state utilities
```

### Module responsibilities

#### `src/utils/workflow-helpers.ts` (new — ~200 lines)
Shared constants and stateless helper functions imported by all three workflow tool modules:
- Constants: `STALE_PIPELINE_HOURS`, `MAX_HANDOFF_DEPTH`, `buildHandoffPrompt()`
- Display maps: `agentNameMap`, `actionNameMap`, `reworkActionMap`, `pipelineAgentRoleMap`
- Pipeline-state guards: `isStalePipeline()`, `isMostRecentPipelineFail()`, `hasDependencyBlocked()`, `isBlockedByDependencies()`
- Response builders: `extractStalePipelineAction()`, `extractReworkAction()`
- WP detail helper: `getHandoffNotesForAgent()`

#### `src/tools/workflow-next-action.ts` (new — ~600 lines)
Owns `ledger_get_next_action`. Imports shared helpers from `workflow-helpers.ts`:
- `GetNextActionSchema`, `getNextAction()` (tool entry point)
- Per-agent next-action functions: `getProjectManagerAction()`, `getDeveloperAction()`, `getQaAction()`, `getReviewerAction()`, `getDocumentationAction()`
- Exports: `getDeveloperAction`, `register` (or just the handler — see test re-import notes)

#### `src/tools/workflow-handoff.ts` (new — ~700 lines)
Owns `ledger_get_handoff_status`. Imports shared helpers from `workflow-helpers.ts`:
- `GetHandoffStatusSchema`, `getHandoffStatus()` (tool entry point)
- `nextAgentFromStatus()`, `buildHandoffResponse()` (auto-handoff logic)
- Per-agent handoff functions: `getProjectManagerHandoff()`, `getDeveloperHandoff()`, `getQaHandoff()`, `getReviewerHandoff()`, `getDocumentationHandoff()`

#### `src/tools/workflow-batch-actions.ts` (new — ~350 lines)
Owns `ledger_get_next_actions`. Imports shared helpers from `workflow-helpers.ts`:
- `buildBatchNextSteps()` (batch-only step-builder — moves here from workflow.ts top)
- `GetNextActionsSchema`, `getNextActions()` (tool entry point)

#### `src/tools/workflow.ts` (reduced to ~30 lines)
Thin aggregator. Imports the three sub-modules and provides a unified `register()`:
```typescript
import * as nextActionModule from './workflow-next-action.js';
import * as handoffModule from './workflow-handoff.js';
import * as batchActionsModule from './workflow-batch-actions.js';

export function register(server: McpServer): void {
  nextActionModule.register(server);
  handoffModule.register(server);
  batchActionsModule.register(server);
}

// Re-export for backward compatibility with test imports
export * from './workflow-helpers.js';
export * from './workflow-next-action.js';
export * from './workflow-handoff.js';
export * from './workflow-batch-actions.js';
export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP } from '../utils/pipeline-maps.js';
```

#### `src/tools/help-content.ts` (new — ~580 lines)
Contains the `TOOL_HELP` record and all static documentation strings, exported as named constants.

#### `src/tools/help.ts` (reduced to ~40 lines)
Imports from `help-content.ts`, defines the Zod schema, handler, and `register()`.

---

## Rationale

- **Targeted, minimal disruption:** Each new file maps 1:1 to an existing logical block in workflow.ts. No business logic changes.
- **Backward-compat re-exports:** The `workflow.ts` aggregator re-exports everything so `index.ts` and any future integrators require zero changes.
- **Test-import update is the only breaking change:** `tests/tools/workflow-handoff.test.ts` currently imports everything from `workflow.ts`. After the split, its destructured imports should point to the appropriate new modules for clarity. Because re-exports are in place, updating is optional (tests will still pass), but is recommended to keep test imports aligned with source locations.
- **`utils/` placement for helpers:** Pipeline-state utilities are pure functions with no tool-registration logic — they belong in `utils/`, matching the existing pattern (`pipeline-maps.ts`, `timestamp.ts`, `wp-id.ts`).
- **`help-content.ts` stays in `tools/`:** The content is tightly coupled to the help tool and has no reuse elsewhere.
- **`work-package.ts` (675 lines) is NOT split:** While borderline, its five tools are cohesive and the file has a clean linear structure. Adding a split here would create overhead without a clear benefit. Revisit if it grows further.

---

## Detailed Steps

### Phase 1: Extract shared workflow utilities

1. Create `src/utils/workflow-helpers.ts`.
2. Move into it: `STALE_PIPELINE_HOURS`, `MAX_HANDOFF_DEPTH`, `buildHandoffPrompt()`, display maps, `isStalePipeline()`, `isMostRecentPipelineFail()`, `hasDependencyBlocked()`, `isBlockedByDependencies()`, `extractStalePipelineAction()`, `extractReworkAction()`, `getHandoffNotesForAgent()`.
3. All moved symbols must be exported from the new file.
4. Update `workflow.ts` to import them from `../utils/workflow-helpers.js` — **run `npm test` to verify green**.

### Phase 2: Extract `ledger_get_next_action` tool

5. Create `src/tools/workflow-next-action.ts`.
6. Move into it: `GetNextActionSchema`, `getNextAction()`, and the five `get*Action()` per-agent functions.
7. Export `getDeveloperAction` (currently exported in workflow.ts for test access).
8. Add a `register()` function that registers only `ledger_get_next_action`.
9. In `workflow.ts`, replace the moved code with an import and delegate call — **run `npm test` to verify green**.

### Phase 3: Extract `ledger_get_handoff_status` tool

10. Create `src/tools/workflow-handoff.ts`.
11. Move into it: `nextAgentFromStatus()`, `buildHandoffResponse()`, `GetHandoffStatusSchema`, `getHandoffStatus()`, and the five `get*Handoff()` per-agent functions.
12. Add a `register()` function that registers only `ledger_get_handoff_status`.
13. In `workflow.ts`, replace the moved code with an import and delegate call — **run `npm test` to verify green**.

### Phase 4: Extract `ledger_get_next_actions` batch tool

14. Create `src/tools/workflow-batch-actions.ts`.
15. Move into it: `buildBatchNextSteps()`, `GetNextActionsSchema`, `getNextActions()`.
16. Add a `register()` function that registers only `ledger_get_next_actions`.
17. In `workflow.ts`, reduce to the thin aggregator shape described above — **run `npm test` to verify green**.

### Phase 5: Extract help content

18. Create `src/tools/help-content.ts`.
19. Move the `TOOL_HELP` record and any other static string constants into it with named exports.
20. Update `help.ts` to import from `./help-content.js` — **run `npm test` to verify green**.

### Phase 6: Update test imports (recommended, not blocking)

21. Update `tests/tools/workflow-handoff.test.ts` to import each symbol group from its actual source module rather than from `workflow.ts`. The re-exports mean this is not required for green tests, but it eliminates the indirection.

### Phase 7: Update manifest documentation

22. Update `mcp-server/docs/agents/project-manifest/file-tree.md` — add the four new source files with annotations.
23. Update `mcp-server/docs/agents/project-manifest/api-surface.md` — note the new module locations for the workflow-tool functions.
24. Update `mcp-server/docs/agents/project-manifest/tech-stack.md` if the architectural patterns section mentions file organisation.

---

## Dependencies

- TypeScript 5.7.2 — no version constraint impact
- Vitest — test runner; each phase ends with a green `npm test` checkpoint
- All module imports must use `.js` extension (ESM, as required by the existing build setup — see `mcp-server/docs/agents/project-manifest/constraints.md`)

---

## Required Components

### New files (to create)
- `mcp-server/src/utils/workflow-helpers.ts`
- `mcp-server/src/tools/workflow-next-action.ts`
- `mcp-server/src/tools/workflow-handoff.ts`
- `mcp-server/src/tools/workflow-batch-actions.ts`
- `mcp-server/src/tools/help-content.ts`

### Modified files
- `mcp-server/src/tools/workflow.ts` — reduced to thin aggregator + re-exports
- `mcp-server/src/tools/help.ts` — reduced to schema + handler + register()
- `mcp-server/tests/tools/workflow-handoff.test.ts` — import paths updated (phase 6)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — new entries
- `mcp-server/docs/agents/project-manifest/api-surface.md` — module location notes

### Unchanged
- `mcp-server/src/index.ts` — no change required
- `mcp-server/src/utils/pipeline-maps.ts` — no change required
- All schema, storage, and other tool files — not touched

---

## Assumptions

- The refactor is purely structural — no logic changes, no new features, no schema changes.
- `npm test` (Vitest) is the acceptance gate after each phase; all 1,333-line `workflow-handoff.test.ts` tests must stay green.
- The re-export strategy in the `workflow.ts` aggregator is acceptable for backward compatibility. If the team prefers stricter encapsulation (no re-exports), the test imports must be updated before any backward-compat re-exports are removed.
- `work-package.ts` (675 lines) and `pipeline.ts` (519 lines) are **out of scope** for this plan.
- `ledger-store.ts` (380 lines) is **out of scope** — it is well-organised and appropriately sized for a repository class.

---

## Constraints

- All new `.ts` files must use ESM import paths with `.js` extension (e.g., `import { x } from './workflow-helpers.js'`).
- No writes to `stdout` — STDIO discipline constraint applies to any new error-handling code.
- No changes to the Zod schemas or MCP tool descriptions — external tool signatures must be byte-identical.
- No changes to `mcp-server/storage/` runtime data or `.meta.json` format.

---

## Out of Scope

- Splitting `work-package.ts`, `pipeline.ts`, or `project-lifecycle.ts`
- Adding new tools or modifying any tool's behaviour
- Changing any MCP schema, response shape, or tool description string
- Git branching strategy

---

## Acceptance Criteria

- `npm test` passes with **zero failures** after the full refactor.
- `workflow.ts` is ≤ 50 lines.
- No individual new file exceeds 750 lines.
- `help.ts` is ≤ 60 lines (excluding the content file).
- `src/index.ts` is **unchanged**.
- TypeScript compiles with zero errors (`tsc --noEmit`).
- The MCP server starts and all 19 tools are registered (verified by the startup log in `index.ts`).

---

## Testing Strategy

The existing test suite is comprehensive and serves as the primary regression guard:

- **`tests/tools/workflow-handoff.test.ts`** (1,333 lines) — covers `getQaHandoff`, `getReviewerHandoff`, `getDocumentationHandoff`, `getDeveloperHandoff`, `getDeveloperAction`, `isMostRecentPipelineFail`, `isStalePipeline`, `getHandoffNotesForAgent`, `extractReworkAction`, `nextAgentFromStatus`, `buildHandoffResponse`, `buildHandoffPrompt`, auto-handoff depth logic.
- **`tests/integration/auto-handoff.test.ts`** and **`tests/integration/full-workflow.test.ts`** — end-to-end smoke tests.
- Run `npm test` after each phase (Steps 4, 9, 13, 17, 20).
- No new test files are required, but Phase 6 recommends updating test imports for clarity.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Circular imports between new modules** | `workflow-helpers.ts` lives in `utils/` and imports from `schema/` and `storage/` only — never from `tools/`. The three tool files import from `utils/workflow-helpers.ts`, not from each other. |
| **Re-export namespace clashes** | Before adding re-exports to `workflow.ts`, check for name conflicts across the four new modules. All exported function names are unique today, but verify during Phase 4. |
| **Test imports silently resolving via re-exports (hiding the split)** | Phase 6 (updating test imports) is explicitly listed to avoid this. |
| **`help-content.ts` strings containing template literals that TypeScript misparses** | The strings use backtick literals; review for any unintended interpolation when moving them between files. |
| **`work-package.ts` growing further while in scope** | Add a line-count check to the CI workflow or note in `constraints.md` that files in `tools/` should not exceed 800 lines without a split plan. |
