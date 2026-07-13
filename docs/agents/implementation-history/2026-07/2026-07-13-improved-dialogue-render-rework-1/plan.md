# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context

The `2026-07-13-improved-dialogue-render` project introduced `renderChunksToDialogue()` alongside
the existing `renderChunksToMarkdown()` in `mcp-server/gui/chunk-renderer.ts`. The module grew to
1,235 lines. The synthesis identified several carry-forward items, the most architecturally
significant being the module split. Additionally, a pre-existing test failure in
`run-log-server.test.ts` has been flagged in multiple syntheses and should be resolved to prevent
it from being confused with regressions.

Knowledge insight KN-0069 ("Prefer separate functions over a mode parameter when producing distinct
output formats from the same input") directly validates the architectural decision of keeping two
independent renderer functions rather than adding a mode parameter — the split proposed here
preserves this pattern.

---

## Summary

This rework plan addresses the maintenance-oriented carry-forward items from the
`2026-07-13-improved-dialogue-render` synthesis. Four items are promoted:

1. **Split `chunk-renderer.ts`** into two co-located files — `chunk-accumulator.ts`
   (types, parsing, merging) and `chunk-renderer.ts` (rendering functions) — improving
   navigability and enabling independent evolution of each layer.
2. **Fix the pre-existing `run-log-server.test.ts` failure** — the namespaced
   `GET /:repo/:slug/runs` route intentionally skips `.meta.json` validation (to serve
   logs for active runs before ledger initialisation), but the test expects a 404.
   The test must be corrected to match the route's intentional design.
3. **Add output-line truncation to `extractExecuteResult`** — long single-line outputs
   (e.g. minified JSON) can produce unwieldy `↳` lines; cap at a configurable limit.
4. **Document the `execute` ToolMessage default-success behaviour** with an inline
   JSDoc comment.

---

## Architectural Context

**`mcp-server/gui/chunk-renderer.ts`** (1,235 lines) is a pure-function module with zero I/O
and no imports from `mcp-server/src/`. It contains two logical layers:

1. **Accumulation layer** (lines 1–607): types (`JsonValue`, `ToolCallChunk`,
   `MergedToolCall`, `ContentBlock`, `MergedMessage`, `NamespaceKey`), parsing
   (`isValidHeader`, `parseChunkLine`), merging (`chunkId`, `chunkType`,
   `mergeContent`, `mergeToolCallChunks`, `mergeUsageMetadata`), namespace helpers
   (`namespaceKey`, `namespaceLabel`), and the core `accumulateChunks()` function.
   Also: `msgRole`, `renderContent`, `renderToolCalls` (rendering utilities;
   `renderContent` is shared by both renderers — called inside `buildToolResultIndex`
   and `renderDialogueMessages` in addition to the Markdown helpers), and
   `renderNamespaceBlock`, `collectTotalUsage`.

2. **Rendering layer** (lines 609–1235): two exported renderers —
   `renderChunksToMarkdown` (verbose, used for debugging) and
   `renderChunksToDialogue` (compact, used in production) — plus dialogue-specific
   helpers: `buildToolCallIndex`, `buildToolResultIndex`, `abbreviateCommand`,
   `extractExecuteResult`, per-family formatters (`formatFileToolDetail`,
   `formatExecuteDetail`, `formatTaskDetail`, `formatWriteTodosDetail`,
   `formatLedgerToolDetail`), `getToolDetailLines`, `renderDialogueMessages`,
   `renderDialogueNamespaceBlock`.

**`mcp-server/tests/gui/chunk-renderer.test.ts`** (1,137 lines) contains 25 describe
blocks: 11 for `renderChunksToMarkdown`, 14 for `renderChunksToDialogue`.

**`mcp-server/tests/gui/run-log-server.test.ts`** — line 295 asserts that
`GET /api/projects/nonexistent-repo/unknown-slug/runs` returns 404 when `.meta.json`
is absent. But `mcp-server/gui/server.ts` lines 1084–1110 intentionally skip
`resolveRepoName()` for the namespaced runs route (so logs are accessible during active
orchestrator runs before the ledger is initialised). The route returns an empty `[]`
(200), which is correct by design. The test's expectation is wrong.

---

## Approach / Architecture

### Step A — Split `chunk-renderer.ts`

Create a new file `mcp-server/gui/chunk-accumulator.ts` containing:
- All type definitions (`JsonValue`, `ToolCallChunk`, `MergedToolCall`, `ContentBlock`,
  `MergedMessage`, `NamespaceKey`)
- All parsing helpers (`isValidHeader`, `parseChunkLine`)
- All merging helpers (`chunkId`, `chunkType`, `mergeContent`, `mergeToolCallChunks`,
  `mergeUsageMetadata`)
- Namespace helpers (`namespaceKey`, `namespaceLabel`)
- The core `accumulateChunks()` function

All of these become **named exports** from `chunk-accumulator.ts`. The existing
`chunk-renderer.ts` retains:
- Both exported renderers (`renderChunksToMarkdown`, `renderChunksToDialogue`)
- All rendering helpers (Markdown: `msgRole`, `renderContent`, `renderToolCalls`,
  `renderNamespaceBlock`, `collectTotalUsage`; Dialogue: `buildToolCallIndex`,
  `buildToolResultIndex`, `abbreviateCommand`, `extractExecuteResult`, all `format*`
  helpers, `getToolDetailLines`, `renderDialogueMessages`,
  `renderDialogueNamespaceBlock`)
- A single import line from `./chunk-accumulator.js`

The public API (`renderChunksToMarkdown`, `renderChunksToDialogue` exported from
`chunk-renderer.ts`) remains unchanged — no consumer needs to change.

### Step B — Fix `run-log-server.test.ts`

Update the test at line 295 to expect 200 + `[]` instead of 404 + NOT_FOUND. Add a
clarifying comment explaining that the route intentionally skips `.meta.json` validation.

### Step C — Add `extractExecuteResult` truncation

After extracting the last output line (the `summary`), truncate it to 120 characters
with an `…` suffix if it exceeds the limit. This prevents unwieldy `↳` lines in the
dialogue output.

### Step D — Document default-success behaviour

Add an inline `@remarks` JSDoc block to `extractExecuteResult` explaining that when the
`[Command succeeded/failed...]` footer is absent, the function defaults to
`success = true`.

---

## Rationale

- **Module split:** The file is 1,235 lines and growing. Both renderers depend on a
  shared accumulation layer, making it the natural seam. Splitting at this boundary
  keeps each file under 700 lines, improves discoverability, and allows the accumulation
  logic to be tested independently in the future. The split follows KN-0069's principle:
  the two renderers remain separate functions in the same file, while the shared
  accumulation layer they both consume moves to its own file.
- **Test fix:** A failing test that's been flagged in multiple syntheses should be
  resolved to avoid confusion with genuine regressions. The fix aligns the test with the
  route's intentional design.
- **Truncation:** Minified JSON or very long single-line outputs are realistic in
  orchestrator runs. Capping the displayed line at 120 characters keeps the dialogue
  view scannable without losing signal (the full output is still in the raw JSONL).
- **JSDoc comment:** The `success = true` default when no footer is found is
  non-obvious. A `@remarks` block prevents future contributors from changing it.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Split boundary | Types + parsing + merging → `chunk-accumulator.ts` | (a) Split by renderer: one file per renderer + shared types; (b) Three-way split: types, accumulation, renderers | (a) duplicates the shared accumulation import path; (b) three files for a module this size is over-split — two files at the natural seam is sufficient |
| Truncation limit | 120 chars hard-coded in `extractExecuteResult` | (a) Configurable via parameter; (b) No truncation (defer) | (a) Over-engineers — no caller needs a different limit today; the constant is trivial to change later. (b) Deferring further allows unwieldy lines in production |
| Test fix strategy | Update assertion to match route design | (a) Add `.meta.json` guard to the route | (a) Breaks the route's intentional design — active orchestrator runs write logs before the ledger is initialised, so the route must work without `.meta.json` |

---

## Pattern Alignment

- **Pure-function module, no I/O:** `chunk-accumulator.ts` continues the zero-I/O
  invariant established in `chunk-renderer.ts`. No filesystem, network, or process
  calls. (`mcp-server/gui/chunk-renderer.ts` module header comment)
- **Named exports for internal modules:** Follows the pattern used by
  `mcp-server/src/gui/handlers/run-log-handlers.ts` which exports named functions
  consumed by `server.ts`.
- **Test file mirrors source file:** `chunk-renderer.test.ts` stays as a single test
  file even though the source is split — the public API hasn't changed. This follows
  the existing pattern where tests import from the public module, not internal files.

---

## Detailed Steps

### Step 1 — Create `chunk-accumulator.ts`

Create `mcp-server/gui/chunk-accumulator.ts` containing:
1. Module-level JSDoc documenting its role as the shared accumulation layer.
2. All type definitions: `JsonValue`, `ToolCallChunk`, `MergedToolCall`,
   `ContentBlock`, `MergedMessage`, `NamespaceKey` — exported as named types.
3. All parsing functions: `isValidHeader`, `parseChunkLine` — exported.
4. All merging functions: `chunkId`, `chunkType`, `mergeContent`,
   `mergeToolCallChunks`, `mergeUsageMetadata` — exported.
5. Namespace helpers: `namespaceKey`, `namespaceLabel` — exported.
6. `accumulateChunks()` — exported.

### Step 2 — Refactor `chunk-renderer.ts` to import from `chunk-accumulator.ts`

1. Remove the type definitions, parsing, merging, and namespace helpers from
   `chunk-renderer.ts`.
2. Add `import { ... } from './chunk-accumulator.js'` at the top.
3. Update the module-level JSDoc to reference the split (note that types and
   accumulation are now in `chunk-accumulator.ts`).
4. Re-export the types from `chunk-accumulator.ts` if they are needed by external
   test assertions (verify by checking test imports).
5. Verify that `renderChunksToMarkdown` and `renderChunksToDialogue` remain the
   only two public exports from `chunk-renderer.ts`.

### Step 3 — Verify all tests pass

Run the full chunk-renderer test suite (`npx vitest run tests/gui/chunk-renderer.test.ts`)
to confirm that the split introduces no regressions. All 77 tests must pass.

### Step 4 — Add truncation to `extractExecuteResult`

In `chunk-renderer.ts`, modify `extractExecuteResult` to truncate the `summary` string:
```typescript
const MAX_SUMMARY_LENGTH = 120;
if (summary.length > MAX_SUMMARY_LENGTH) {
  summary = summary.slice(0, MAX_SUMMARY_LENGTH - 1) + '…';
}
```

### Step 5 — Add JSDoc `@remarks` to `extractExecuteResult`

Add a `@remarks` block to the existing JSDoc of `extractExecuteResult` explaining:
- When no `[Command succeeded/failed...]` footer is found, the function defaults to
  `success = true`.
- This is intentional: commands that produce output without a footer line are assumed
  to have succeeded. The sibling formatters (`formatExecuteDetail`) display the ✓/✗
  signal based on this value.

### Step 6 — Fix `run-log-server.test.ts`

In `mcp-server/tests/gui/run-log-server.test.ts`, update the test at line 295:
1. Change `expect(status).toBe(404)` → `expect(status).toBe(200)`.
2. Change the second assertion to `expect(body).toEqual([])`.
3. Update the test name to:
   `'GET /:repo/:slug/runs returns 200 with empty array when .meta.json does not exist (route skips meta validation for active runs)'`.
4. Update the inline comment to explain that the route intentionally skips
   `.meta.json` validation because log files must be accessible during active
   orchestrator runs before the ledger is initialised.

### Step 7 — Run the full run-log-server test suite

Run `npx vitest run tests/gui/run-log-server.test.ts` to confirm 22/22 tests pass.

### Step 8 — Update project manifest documentation

Update the following manifest documents:
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — add
  `chunk-accumulator.ts` entry; update `chunk-renderer.ts` description and line count.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add
  `chunk-accumulator.ts` exports section.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add
  `chunk-accumulator.ts` entry in the `gui/` section; update `chunk-renderer.ts`
  line count annotation.

---

## Dependencies

- No external dependencies. All changes are internal to `mcp-server/`.
- Steps 1–3 form a unit (split + verify). Steps 4–5 are independent. Step 6–7 is
  independent. Step 8 depends on all prior steps.

---

## Required Components

- `mcp-server/gui/chunk-accumulator.ts` — **new file** (accumulation layer)
- `mcp-server/gui/chunk-renderer.ts` — **modified** (rendering layer only)
- `mcp-server/tests/gui/run-log-server.test.ts` — **modified** (test fix)
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — **modified** (doc update)
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — **modified** (doc update)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — **modified** (doc update)

---

## Assumptions

- The `chunk-renderer.ts` public API (`renderChunksToMarkdown`, `renderChunksToDialogue`)
  is consumed only by `server.ts` and the test file. No other consumers exist.
- The `run-log-server.test.ts` test at line 295 is the only failing test in the suite.
  All other 21 tests pass.
- The 120-character truncation limit is appropriate for the dialogue panel's typical
  rendering width.

---

## Constraints

- The split must not change any public export signatures. `server.ts` must continue to
  import `renderChunksToDialogue` from `./chunk-renderer.js` without changes.
- The accumulator file must remain a pure-function module: no I/O, no side effects, no
  imports from `mcp-server/src/`.
- The test fix must not change the route handler behaviour — only the test assertion.

---

## Out of Scope

- Adding a toggle between verbose/compact renderers in the GUI frontend.
- Splitting the test file (`chunk-renderer.test.ts`). The tests import from the public
  module, not internal files, so splitting the source does not require splitting tests.
- Addressing the `write_todos` empty-array edge case (cosmetic, not a defect).
- Adding rendering for new tool families.

---

## Acceptance Criteria

- AC-01: `mcp-server/gui/chunk-accumulator.ts` exists and exports all type definitions,
  parsing, merging, and accumulation functions previously in `chunk-renderer.ts`.
- AC-02: `mcp-server/gui/chunk-renderer.ts` imports from `./chunk-accumulator.js` and
  no longer contains type definitions or accumulation functions.
- AC-03: `renderChunksToMarkdown` and `renderChunksToDialogue` remain the only public
  exports of `chunk-renderer.ts`. No consumer changes required.
- AC-04: All 77 chunk-renderer tests pass without modification (no test imports need
  updating).
- AC-05: `extractExecuteResult` truncates the summary line to ≤ 120 characters with
  `…` when exceeded.
- AC-06: `extractExecuteResult` has a `@remarks` JSDoc block documenting the
  `success = true` default when no footer is found.
- AC-07: `run-log-server.test.ts` test "GET /:repo/:slug/runs returns 200 with empty
  array when .meta.json does not exist" passes (previously expected 404).
- AC-08: All 22 run-log-server tests pass.
- AC-09: `mcp-server/gui/docs/agents/project-manifest/file-tree.md` lists
  `chunk-accumulator.ts`.
- AC-10: `mcp-server/docs/agents/project-manifest/file-tree.md` lists
  `chunk-accumulator.ts` in the `gui/` section.
- AC-11: TypeScript compilation (`tsc --noEmit`) reports zero errors.

---

## Testing Strategy

The module split is purely structural — no logic changes. The existing 77 chunk-renderer
tests serve as a complete regression suite. The truncation change adds a new code path
that requires new test coverage. The run-log test fix corrects an assertion.

---

## Test Plan

- `mcp-server/tests/gui/chunk-renderer.test.ts` — all 77 existing tests pass unchanged
  (regression for AC-01–AC-04). Tests import from the public `chunk-renderer.ts` export,
  so no test import changes are needed.
- `mcp-server/tests/gui/chunk-renderer.test.ts` — **new test**: `extractExecuteResult`
  truncates long summary lines to ≤ 120 characters. Provide a content string with a
  200-character last line and verify the returned `summary` is 120 characters ending
  with `…`. Covers AC-05.
- `mcp-server/tests/gui/chunk-renderer.test.ts` — **new test**: `renderChunksToDialogue`
  with an `execute` tool whose ToolMessage has a very long last output line — assert the
  `↳` line contains the truncated summary. Covers AC-05 at the integration level.
- `mcp-server/tests/gui/run-log-server.test.ts` — test at line 295 updated to expect
  200 + `[]`. All 22 tests pass. Covers AC-07, AC-08.

---

## Documentation Updates

- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — add `chunk-accumulator.ts`
  entry with description "Pure JSONL parsing, chunk merging, and namespace accumulation
  (types + accumulateChunks)"; update `chunk-renderer.ts` line count and description.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add
  `chunk-accumulator.ts` exports section listing all exported types and functions.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — add `chunk-accumulator.ts`
  in the `gui/` tree; update `chunk-renderer.ts` annotation.

---

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | Edge case: JSONL containing only ToolMessages produces empty output rather than `*No dialogue recorded.*` sentinel | Synthesis item #5 (code review) | Real-world chunk files always contain AI messages; no production impact | Reconsider if chunk-renderer is reused for non-orchestrator JSONL sources |
| 2 | `write_todos` with empty `todos` array renders only the header with no checklist lines | Synthesis item #6 (code review) | Current behaviour is not a defect; cosmetic only | Could add `(no todos)` note in a future UX pass |
| 3 | Stale `renderChunksToMarkdown` reference in `api-surface.md` `getChunkRendered` description | Synthesis item #2 | Appears to have been resolved during the original project — no stale reference found in current `api-surface.md` | No action needed |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Circular import between accumulator and renderer** | The dependency is strictly one-way: renderer → accumulator. The accumulator has no knowledge of renderers. Verify with `tsc --noEmit`. |
| **Test imports break after split** | Tests import from `chunk-renderer.ts` (the public API). Since the public exports don't change, no test modifications are needed for the split itself. |
| **Truncation hides important diagnostic info** | 120 chars is generous — most meaningful output fits. The full output remains available in the raw JSONL, and `renderChunksToMarkdown` (verbose) is still available for debugging. |
| **Run-log test fix masks a real bug** | The route's design is documented in `server.ts` with a clear comment explaining why `.meta.json` is not consulted. The test expectation was simply wrong from the start. |
