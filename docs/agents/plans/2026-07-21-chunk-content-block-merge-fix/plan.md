# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.6.0 (plan created and immediately implemented by Plan Auditor)
- Architectural Reviews: none — Plan Architect Reviewer v2.1.0

## Summary

Fix the dialogue rendering bug where inner agent (sub-agent) content in orchestrator dialogue previews displays as raw JSON with `&quot;` HTML entities instead of clean text and tool-call cards. The root cause is a two-part defect: (1) `mergeContent()` in the chunk accumulator aligns incoming content blocks by array position instead of the block's semantic `index` field, causing `tool_use` and `input_json_delta` blocks to overwrite accumulated `text` blocks; (2) `renderContent()` in the chunk renderer serialises the corrupted non-text blocks as JSON fences, which the client-side text renderer displays as raw escaped JSON. The fix corrects the merge alignment and adds a safety-net filter for known-redundant block types.

## Architectural Context

The GUI's dialogue rendering pipeline flows through three layers:

1. **Chunk accumulator** (`mcp-server/gui/chunk-accumulator.ts`) — parses JSONL chunk files, merges streaming `AIMessageChunk` fragments into `MergedMessage` objects grouped by namespace. Key merge functions: `mergeContent()` for text/content blocks, `mergeToolCallChunks()` for tool-call fragments, `mergeUsageMetadata()` for token counts.

2. **Chunk renderer** (`mcp-server/gui/chunk-renderer.ts`) — consumes the accumulated message map and produces output in three formats: Markdown (debug), dialogue (compact Markdown), and structured (`DialogueBlock[]` for the frontend). `renderContent()` is the shared text extractor used by all three.

3. **Client-side renderer** (`mcp-server/gui/public/views/project-detail-dialogues.js`) — receives `DialogueBlock[]` from the structured renderer and builds interactive HTML: `_buildDialogueTextBlock()` for text, `_buildDialogueToolCallBlock()` for tool calls, etc.

Anthropic's streaming API sends content as arrays of typed blocks with a semantic `index` field:
- `[{type:"text", index:0, text:"I'll..."}]` — text token at content slot 0
- `[{type:"tool_use", index:1, id:"toolu_...", name:"ledger_get_next_action"}]` — tool invocation at slot 1
- `[{type:"input_json_delta", index:1, partial_json:"{\"agent_role\""}]` — arg fragment at slot 1

Each chunk carries a **single-element array**, but the block's `index` field indicates its logical position within the full content array. The `tool_calls` / `tool_call_chunks` fields on the same message duplicate the tool information from the content blocks.

## Approach / Architecture

Two targeted fixes in the accumulation and rendering layers:

**Fix 1 — Index-aligned content block merging.** Modify `mergeContent()` to read each incoming block's `index` field (when present and numeric) and use it for alignment instead of the loop variable `i`. When the accumulator array is shorter than the target index, fill intermediate slots. This mirrors the pattern already used by `mergeToolCallChunks()` for tool-call fragments.

**Fix 2 — Filter redundant content block types.** Modify `renderContent()` to skip blocks whose `type` is `tool_use` or `input_json_delta`. These blocks are always redundant with the `tool_calls` array that is processed separately. This acts as a defence-in-depth: even if merge alignment is correct, these block types should never appear in rendered text output.

## Rationale

- Fix 1 addresses the root cause: incorrect array-position alignment corrupts the accumulated content. The `index` field is the Anthropic-standard semantic key for block identity, and the codebase already uses this pattern for `tool_call_chunks`.
- Fix 2 is a safety net: `tool_use` and `input_json_delta` blocks carry no information not already captured in `tool_calls`/`tool_call_chunks`. Filtering them is semantically correct regardless of the merge fix, and prevents any future regression where an unexpected block type leaks into rendered output.
- Both fixes are backward-compatible: existing JSONL files with only string content or text-only block arrays are unaffected.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Merge alignment strategy | Use block's `index` field with sparse-fill | (a) Use block `id` field for matching; (b) Discard all non-text blocks before accumulation | `index` is the canonical alignment key used by Anthropic and already used for tool_call_chunks. Block `id` is not consistently present. Discarding before accumulation would lose data for the Markdown debug renderer. |
| Filter scope in `renderContent()` | Explicit `tool_use` + `input_json_delta` skip list | (a) Skip all non-`text` blocks; (b) No filter (rely solely on merge fix) | Explicit skip list preserves rendering of genuinely non-text blocks (e.g. `image`) for the Markdown debug format. Relying solely on merge fix is fragile against future content block type additions. |

## Pattern Alignment

- **Index-keyed merge** — follows existing `mergeToolCallChunks()` in `chunk-accumulator.ts` (L170–190), which reads `tc.index` for alignment. The content block fix applies the identical pattern.
- **Pure data transformation** — all functions in `chunk-accumulator.ts` and `chunk-renderer.ts` are pure (no I/O). Changes preserve this invariant.
- **Existing test patterns** — new tests follow the `describe('renderer — feature')` naming convention and use existing builder helpers (`chunkLine`, `HEADER`, `aiChunk`).

## Detailed Steps

### Step 1: Fix `mergeContent()` index alignment

In `mcp-server/gui/chunk-accumulator.ts`, modify the array+array merge branch of `mergeContent()`:

1. For each incoming block, read its `index` property. If `typeof block.index === 'number'`, use that as the target position in the result array. Otherwise, fall back to the loop variable `i` (preserving backward compatibility with blocks that lack an `index` field).
2. When the target position exceeds the current result array length, extend the array with `undefined` slots (sparse fill), then place the block. Use a local helper or inline logic to handle the sparse-to-contiguous conversion.
3. For the merge logic at the target position:
   - If both existing and incoming blocks are `type: 'text'`, concatenate `text` fields (existing behaviour, now at the correct position).
   - Otherwise, spread-merge `{ ...existing, ...block }` (existing behaviour, now at the correct position).
4. Ensure the returned array has no `undefined` gaps — filter out empty slots after the merge loop.

### Step 2: Filter redundant content block types in `renderContent()`

In `mcp-server/gui/chunk-renderer.ts`, modify `renderContent()`:

1. Inside the `Array.isArray(content)` branch, before processing each block, skip blocks whose `type` is `'tool_use'` or `'input_json_delta'`. These are streaming artefacts that duplicate data already captured in `tool_calls`/`tool_call_chunks`.
2. Keep the existing `else` branch (JSON fence for non-text blocks like `image`) for any other non-text types that may appear in future.

### Step 3: Add unit tests

In `mcp-server/tests/gui/chunk-renderer.test.ts`:

1. **Test: `mergeContent()` index alignment** — Create a test that simulates a realistic Anthropic streaming sequence: a text block at `index: 0`, a `tool_use` block at `index: 1`, and multiple `input_json_delta` blocks at `index: 1`. Verify that:
   - The text block is preserved (not overwritten).
   - Tool calls are rendered via `Tool call:` cards.
   - No raw JSON appears in dialogue/structured output.

2. **Test: `renderContent()` filter** — Create a test with content blocks that include `tool_use` and `input_json_delta` types (manually constructed, bypassing the accumulator). Verify these block types are excluded from the rendered text output.

3. **Test: end-to-end structured rendering** — Create a test using `renderChunksToStructured()` with realistic multi-chunk JSONL simulating the exact streaming pattern from the bug (text at index 0, tool_use at index 1, input_json_delta fragments at index 1, all in single-element arrays across sequential chunks with the same message id). Verify the structured output contains a `text` block and a `tool-call` block, not raw JSON.

### Step 4: Run tests

Run the full GUI test suite to confirm all existing and new tests pass:
```
cd mcp-server && npx vitest run tests/gui/
```

## Dependencies
- None. Both source files (`chunk-accumulator.ts`, `chunk-renderer.ts`) are self-contained modules with no external dependencies beyond each other.

## Required Components
- `mcp-server/gui/chunk-accumulator.ts` — modify `mergeContent()` function
- `mcp-server/gui/chunk-renderer.ts` — modify `renderContent()` function
- `mcp-server/tests/gui/chunk-renderer.test.ts` — add new test cases

## Assumptions
- The `index` field on Anthropic content blocks is always a non-negative integer when present.
- The `tool_use` and `input_json_delta` content block types are always redundant with the `tool_calls`/`tool_call_chunks` message fields. This has been verified against the LangChain Anthropic integration and real JSONL captures.
- No non-Anthropic provider currently emits content blocks with an `index` field. If they do in future, the fallback to loop-variable alignment ensures backward compatibility.

## Constraints
- All functions in `chunk-accumulator.ts` and `chunk-renderer.ts` must remain pure (no I/O, no side effects).
- The `ContentBlock` interface must not be changed (it already accepts `index` via its index signature).
- The Markdown renderer's ability to display non-text blocks as JSON fences (e.g. `image` type) must be preserved.

## Out of Scope
- Client-side rendering changes (`project-detail-dialogues.js`) — the bug is entirely server-side.
- Changes to the JSONL capture format or the orchestrator's chunk writer.
- Handling of other future content block types beyond `tool_use` and `input_json_delta`.

## Acceptance Criteria

- AC-01: Content blocks with `index` fields are merged at their semantic position, not array position. A text block at `index: 0` is not overwritten by a `tool_use` block arriving at array position 0 with `index: 1`.
- AC-02: `renderContent()` skips `tool_use` and `input_json_delta` blocks, producing only text content from `type: 'text'` blocks.
- AC-03: Dialogue preview modals for sub-agent namespaces display clean prose text and formatted tool-call cards instead of raw JSON with `&quot;` entities.
- AC-04: The Markdown debug renderer continues to render genuinely non-text blocks (e.g. `image`) as JSON fences.
- AC-05: All existing tests in `tests/gui/chunk-renderer.test.ts` continue to pass.
- AC-06: New tests cover: (a) index-aligned merge with mixed text/tool_use/input_json_delta blocks, (b) renderContent filter for redundant block types, (c) end-to-end structured rendering with realistic Anthropic streaming patterns.

## Testing Strategy

Unit tests in the existing Vitest test file (`tests/gui/chunk-renderer.test.ts`). The tests exercise the public API of both renderers — `renderChunksToDialogue()`, `renderChunksToMarkdown()`, and `renderChunksToStructured()` — with JSONL input that reproduces the exact streaming pattern observed in the bug. No integration or manual testing is required since the bug is fully reproducible with synthetic chunk data.

## Test Plan

- `tests/gui/chunk-renderer.test.ts` — `mergeContent preserves text blocks when tool_use arrives at different index` — verifies AC-01: text at index 0 is preserved when tool_use at index 1 arrives at array position 0.
- `tests/gui/chunk-renderer.test.ts` — `renderContent filters tool_use and input_json_delta blocks` — verifies AC-02, AC-04: redundant types skipped, other non-text types preserved.
- `tests/gui/chunk-renderer.test.ts` — `renderChunksToStructured produces text + tool-call blocks from realistic Anthropic streaming` — verifies AC-03, AC-06(c): end-to-end test with multi-chunk JSONL.
- `tests/gui/chunk-renderer.test.ts` — all existing tests — verifies AC-05: no regressions.

## Documentation Updates

- No documentation changes required. The fix is internal to the GUI rendering pipeline and does not change any public API, MCP tool signature, or user-facing configuration.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Index field absent on non-Anthropic providers** | Fallback to loop-variable `i` when `block.index` is not a number. Preserves existing behaviour for providers that don't set `index`. |
| **Sparse array gaps from high index values** | Filter `undefined` slots from the result array after the merge loop. The gap scenario only occurs with content blocks, which in practice have indices 0–5 at most. |
| **Markdown renderer loses tool_use/input_json_delta JSON fences** | These blocks are redundant with `tool_calls` which the Markdown renderer already displays as separate fenced blocks. Filtering them improves Markdown output quality. |
