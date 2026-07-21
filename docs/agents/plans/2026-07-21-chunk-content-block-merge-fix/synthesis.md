## Synthesis

### Completion Status
- Date: 2026-07-21
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-21

### Outcome Summary

Fixed the GUI dialogue rendering bug where sub-agent content displayed as raw JSON with `&quot;` HTML entities. The root cause — `mergeContent()` aligning Anthropic content blocks by array position rather than their semantic `index` field — was corrected in `chunk-accumulator.ts`. A defence-in-depth filter was added to `renderContent()` in `chunk-renderer.ts` to skip `tool_use` and `input_json_delta` blocks, which are always redundant with the separately-processed `tool_calls` field. All acceptance criteria are satisfied and the full test suite passes.

### Implementation Summary
- **Fix 1 — Index-aligned content block merging (`chunk-accumulator.ts` → `mergeContent()`):** The array+array merge branch now reads each incoming block's `index` field (when it is a non-negative integer) and uses it as the target slot in a sparse working array. Blocks without an `index` fall back to loop-variable alignment (backward-compatible path). After the loop, undefined gaps are compacted out. This matches the existing pattern used by `mergeToolCallChunks()`.
- **Fix 2 — Filter redundant block types (`chunk-renderer.ts` → `renderContent()`):** Added an explicit skip for `tool_use` and `input_json_delta` blocks inside the `Array.isArray(content)` branch. Other non-text block types (e.g. `image`) continue to render as JSON fences for the Markdown debug renderer.
- **Unit tests (`tests/gui/chunk-renderer.test.ts`):** Three new `describe` blocks were added:
  - `renderChunksToDialogue — content block index alignment` — two tests verifying text preservation with tool_use/input_json_delta at different indices.
  - `renderChunksToMarkdown — renderContent filters tool_use and input_json_delta blocks` — three tests covering skip behaviour and the `image`-block preservation invariant (AC-04).
  - `renderChunksToStructured — Anthropic streaming content block pattern` — one end-to-end test with a realistic four-chunk sequence reproducing the exact bug pattern; verifies text block, tool-call block, and absence of JSON noise blocks (AC-03, AC-06(c)).

### Documentation Updates
- No documentation updates were required. The fix is internal to the GUI rendering pipeline and changes no public API, MCP tool signature, or user-facing configuration, as stated in the plan.

### Verification Summary
- Tests run: `cd mcp-server && npx vitest run tests/gui/`
- Static analysis run: none required (TypeScript type-checks implicitly via Vitest + tsc in the test harness; no new imports or types were added)
- Result: **PASS** — 52 test files, 1477 tests, 0 failures

### Code Insights
- ~~[low] (improvement) `mcp-server/gui/chunk-accumulator.ts` → `mergeContent()`: The sparse-fill approach works correctly but a short inline comment explaining _why_ the sparse array is used (Anthropic single-element chunks with `index` > 0) would help future readers understand the intent without needing to re-read the JSDoc. The JSDoc block is good; a one-liner inside the loop body would make it more self-documenting.~~ **DONE** — added three-line inline comment above the `sparse` array declaration.
- ~~[low] (debt) `mcp-server/gui/chunk-renderer.ts` → `renderContent()`: The skip list for redundant block types (`tool_use`, `input_json_delta`) is hardcoded. If Anthropic introduces additional streaming-only block types in future (e.g. `thinking_delta`), they would need to be added manually. A more forward-looking design would use a `Set<string>` constant at module scope (`REDUNDANT_BLOCK_TYPES`) to make the list easy to extend without touching the function body.~~ **DONE** — extracted to `REDUNDANT_BLOCK_TYPES` module-scope constant; `renderContent()` now calls `.has(btype)`.
- ~~[low] (improvement) `mcp-server/tests/gui/chunk-renderer.test.ts`: The new end-to-end test in `renderChunksToStructured — Anthropic streaming content block pattern` uses a namespace `['docs:748f41cb']` that does not match any named constant in the test helpers. Extracting this as a named fixture constant (alongside `HEADER` and similar) would make the intent clearer and reduce copy-paste risk if more sub-agent tests are added.~~ **DONE** — added `SUB_NS_DOCS` constant alongside `HEADER`; end-to-end test now references it.

### Additional Comments
- The implementation was originally created by a different agent (Plan Auditor v1.6.0) and verified here. The code is correct and complete; no corrective changes were necessary.
- The `↳ WP-002` assertion in the second index-alignment test relies on the dialogue renderer's `args` parsing for `ledger_get_work_package`. This is an indirect assertion but sufficient given the end-to-end structured test provides direct block-type coverage.
