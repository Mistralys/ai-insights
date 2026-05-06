# Plan — Orchestrator Queue Lifecycle Rework 1

## Summary

Follow-up maintenance plan addressing all actionable recommendations from the
`2026-05-06-orchestrator-queue-lifecycle` synthesis. Covers three areas:
(1) continuing the `src/gui/queue/` module extraction to fully decompose
`gui/orchestrator-manager.ts`, (2) hardening tests for edge cases identified
during review, and (3) minor code hygiene items (freeze sentinel, annotate
dead code, verify Python emission).

## Architectural Context

The previous session extracted three pure modules into `mcp-server/src/gui/queue/`:

| Module | Responsibility |
|--------|----------------|
| `resolve-progress.ts` | Backwards JSONL walk → `ProgressResolution` |
| `format-progress-entry.ts` | JSONL entry → human-readable badge text |
| `compute-effective-status.ts` | `(alive, projectExists, hasLogActivity)` → `EffectiveStatus` |

The parent file `mcp-server/gui/orchestrator-manager.ts` (806 lines) still holds:
- Type definitions: `RawQueueEntry`, `QueueEntry`, `KillResult`, `PreflightResult`,
  `StartResult`, `RunStatus`
- Queue reading: `readQueueFile()`, `isRawQueueEntry()`, `getProjectLedgerStatus()`,
  `getQueue()`
- Queue mutation: `writeQueueFileAtomic()`, `removeLockFile()`, `terminateProcess()`,
  `killQueueEntry()`, `dismissQueueEntry()`
- Preflight + launch: 7 check functions, `startOrchestrator()`, `getRunStatus()`

The front-end widget file `mcp-server/gui/public/js/orchestrator-widgets.js` contains
`PROGRESS_BADGE_MAP` with a `'heartbeat'` entry that is unreachable because
`resolveProgress()` never surfaces heartbeat as `lastAction`.

The Python orchestrator (`orchestrator/src/utils/tool_wrappers.py`) emits `tool_call`
events with `tool_name` always present (captured via `getattr(tool, "name", "")`),
so the field is guaranteed to exist but could be an empty string `""` for tools
without a `name` attribute.

## Approach / Architecture

**WP-A — Types extraction:** Move all exported interfaces/types from
`orchestrator-manager.ts` into `src/gui/queue/types.ts`. The parent file re-exports
them for backward compatibility.

**WP-B — `getQueue()` extraction:** Move `getQueue()`, `readQueueFile()`,
`isRawQueueEntry()`, and `getProjectLedgerStatus()` into `src/gui/queue/get-queue.ts`.
The parent file re-exports `getQueue` for backward compatibility.

**WP-C — Edge-case test coverage:** Add targeted test cases to
`resolve-progress.test.ts` for malformed JSONL lines and 0-byte log files.

**WP-D — Code hygiene pass:** Freeze `EMPTY_RESOLUTION`, annotate the dead
`heartbeat` badge map entry, and handle empty-string `tool_name` in
`formatProgressEntry()`.

## Rationale

- The extraction pattern is already established by the prior session's WP-001
  through WP-004. Types and `getQueue` are the natural next slices.
- The test gaps were explicitly called out in the synthesis and are trivial to
  add — no behavioral changes needed.
- The hygiene items are one-line changes with zero runtime cost but improve
  readability and prevent future confusion.

## Detailed Steps

### WP-A — Extract types into `src/gui/queue/types.ts`

1. Create `mcp-server/src/gui/queue/types.ts` containing:
   - `RawQueueEntry` interface
   - `QueueEntry` interface (imports `EffectiveStatus` from `compute-effective-status.ts`)
   - `KillResult` interface
   - `PreflightResult` interface
   - `StartResult` interface
   - `RunStatus` interface
2. Update `orchestrator-manager.ts` to import all types from the new module and
   re-export them (preserves backward compatibility for all existing consumers).
3. Update imports in `get-queue.ts` (WP-B) and any test files that reference these types.
4. Verify `tsc` compiles clean.

### WP-B — Extract `getQueue()` into `src/gui/queue/get-queue.ts`

1. Create `mcp-server/src/gui/queue/get-queue.ts` containing:
   - `readQueueFile()` (private)
   - `isRawQueueEntry()` (private)
   - `getProjectLedgerStatus()` (private)
   - `isProcessAlive()` (private)
   - `getQueue()` (exported)
   - Imports: `RawQueueEntry`, `QueueEntry` from `./types.js`; `resolveProgress`
     from `./resolve-progress.js`; `computeEffectiveStatus` from
     `./compute-effective-status.js`
2. Update `orchestrator-manager.ts`:
   - Remove the extracted functions.
   - Import and re-export `getQueue` from `./src/gui/queue/get-queue.js`.
   - `isProcessAlive` is also used by `killQueueEntry`/`dismissQueueEntry` — either
     duplicate it locally (it's 5 lines) or export it from `get-queue.ts` and import.
3. Ensure existing integration tests (`orchestrator-manager.test.ts`) pass unchanged.
4. Verify `tsc` compiles clean.

### WP-C — Add edge-case tests to `resolve-progress.test.ts`

1. Add test: **malformed JSONL line is skipped gracefully**
   - Write a log file where the last line is `"not valid json {"`, preceded by a
     valid `stage_start` entry.
   - Assert: `resolveProgress` returns the valid entry's summary (skips the bad line).
2. Add test: **all lines malformed → returns empty resolution with logFilename set**
   - Write a log file with only invalid JSON lines.
   - Assert: `summary === null`, `lastAction === null`, `logFilename` is set.
3. Add test: **0-byte (empty) log file → returns empty resolution with logFilename set**
   - Write an empty file matching the slug pattern.
   - Assert: `summary === null`, `lastAction === null`, `logFilename` is the basename.

### WP-D — Code hygiene

1. **Freeze `EMPTY_RESOLUTION`** in `src/gui/queue/resolve-progress.ts`:
   - Add `Object.freeze(EMPTY_RESOLUTION)` after the declaration (or use
     `as const` + freeze).
   - Existing spread usage (`{ ...EMPTY_RESOLUTION, logFilename }`) is unaffected.
2. **Annotate dead `heartbeat` entry** in `gui/public/js/orchestrator-widgets.js`:
   - Add a one-line comment above the `'heartbeat'` key:
     `// NOTE: resolveProgress() never surfaces heartbeat as lastAction — kept for completeness.`
3. **Handle empty-string `tool_name`** in `format-progress-entry.ts`:
   - Change the `tool_call` case to treat `""` the same as absent:
     `return toolName ? \`Tool call: ${toolName}\` : 'Tool call';` — currently uses
     `typeof entry['tool_name'] === 'string'` which includes empty string. Change to:
     `const toolName = ... ? entry['tool_name'] : undefined;` → also check `.length > 0`.
   - Add one unit test for `tool_name: ""` → expects `"Tool call"`.
4. Run full test suite to verify no regressions.

## Dependencies

- WP-A must complete before WP-B (types module is imported by `get-queue.ts`).
- WP-C and WP-D are independent of WP-A/WP-B and of each other.

## Required Components

- `mcp-server/src/gui/queue/types.ts` (new)
- `mcp-server/src/gui/queue/get-queue.ts` (new)
- `mcp-server/src/gui/queue/resolve-progress.ts` (modify — freeze sentinel)
- `mcp-server/src/gui/queue/format-progress-entry.ts` (modify — empty tool_name)
- `mcp-server/gui/orchestrator-manager.ts` (modify — extract, re-export)
- `mcp-server/gui/public/js/orchestrator-widgets.js` (modify — comment)
- `mcp-server/tests/gui/queue/resolve-progress.test.ts` (modify — add 3 tests)
- `mcp-server/tests/gui/queue/format-progress-entry.test.ts` (modify — add 1 test)
- `mcp-server/docs/agents/project-manifest/api-surface.md` (update)
- `mcp-server/docs/agents/project-manifest/file-tree.md` (update)

## Assumptions

- `orchestrator-manager.ts` backward-compatible re-exports are sufficient for all
  existing consumers (GUI route handlers import from this file).
- The Python orchestrator's `getattr(tool, "name", "")` can never produce a truly
  missing `tool_name` key — confirmed in `tool_wrappers.py` line 500 where the
  `stream_entry` dict always includes the field.
- No other module duplicates `isProcessAlive()`; if one appears during extraction,
  consolidate into a shared utility.

## Constraints

- All changes must pass `tsc` clean compilation.
- All existing 2 169 tests must continue to pass.
- No behavioral changes to the queue lifecycle — this is purely structural refactoring
  + test hardening.
- The `gui/orchestrator-manager.ts` public API surface (exported functions and types)
  must remain importable from the same path for backward compatibility.

## Out of Scope

- Extracting preflight/launch logic into a separate module (future session).
- Adding integration tests that exercise the full `startOrchestrator()` path.
- Refactoring `orchestrator-widgets.js` beyond a single comment annotation.
- Modifying the Python orchestrator code.

## Acceptance Criteria

- `mcp-server/src/gui/queue/types.ts` exports all 6 interface/type definitions.
- `mcp-server/src/gui/queue/get-queue.ts` exports `getQueue()` and contains all
  queue-reading internals.
- `orchestrator-manager.ts` is reduced by ~180 lines (types + queue-read logic).
- 3 new edge-case tests pass in `resolve-progress.test.ts`.
- 1 new empty-`tool_name` test passes in `format-progress-entry.test.ts`.
- `EMPTY_RESOLUTION` is `Object.freeze()`-d.
- `PROGRESS_BADGE_MAP['heartbeat']` has an explanatory comment.
- `formatProgressEntry({ action: 'tool_call', tool_name: '' })` returns `"Tool call"`.
- Full test suite passes (zero regressions).
- `api-surface.md` and `file-tree.md` reflect the new file structure.

## Testing Strategy

- **Unit tests (WP-C):** 3 new tests targeting `resolveProgress()` edge cases using
  temp-directory fixtures.
- **Unit tests (WP-D):** 1 new test for empty-string `tool_name` handling.
- **Regression:** Full `npm test` run after each WP to catch import path breakage.
- **Type safety:** `tsc --noEmit` after WP-A and WP-B to verify no type errors from
  the module reorganization.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Circular imports** between `types.ts` and other queue modules | Types module is leaf-level (imports nothing from queue). Verified by the layering: types → compute/format/resolve → get-queue. |
| **Consumers import from deep paths** (e.g. `../../gui/orchestrator-manager.ts`) | Re-exports in the original file guarantee backward compat. Grep for all import sites before completing. |
| **`Object.freeze` breaks spread** on older runtimes | Spread on frozen objects works in all ES2015+ environments. Node.js ≥ 18 is required by this project. |
| **`isProcessAlive` duplication** if extracted to both files | Prefer exporting from `get-queue.ts` and importing in the parent. One canonical location. |
