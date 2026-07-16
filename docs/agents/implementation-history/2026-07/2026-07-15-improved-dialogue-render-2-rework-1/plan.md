# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v2.0.0

## Prior Project Context

This plan is a rework of `2026-07-15-improved-dialogue-render-2`, which transformed the GUI dialogue modal from flat Markdown into an interactive, conversation-style view with collapsible tool calls. That project delivered 7 work packages across 29 pipeline stages with zero regressions. It is the third project in the `improved-dialogue-render` series (`2026-07-13`, `2026-07-13-rework-1`, `2026-07-15`). This rework addresses the deferred items (D-1 through D-7), one out-of-scope cleanup (O-2), and one pre-existing security hardening item identified in the synthesis.

## Summary

Address all actionable carry-forward items from the `2026-07-15-improved-dialogue-render-2` synthesis: eliminate duplicated code in `chunk-renderer.ts` (hoist constant, extract JSONL parsing helper), close test coverage gaps for the `?format=structured` route branches and the API client chunk methods, test the `_dialogueInlineMarkdown` regex fallback, replace an inline style with a CSS class, extract a query-string parsing helper from `server.ts` to DRY 13 repetitions, harden `escapeHtml` with single-quote escaping, and audit the `api-surface.md` API client table for signature accuracy.

## Architectural Context

The GUI subsystem lives in `mcp-server/gui/` and consists of:

- **`chunk-accumulator.ts`** — Pure-function module: types, JSONL parsing, chunk merging, `accumulateChunks()`
- **`chunk-renderer.ts`** (1118 lines) — Rendering layer: three renderers (`renderChunksToMarkdown`, `renderChunksToDialogue`, `renderChunksToStructured`) plus the `DialogueBlock` type
- **`server.ts`** (1870 lines) — Standalone Node.js HTTP server with `matchRoute()` router (~13 query-string parsing repetitions)
- **`public/`** — Static ES5 frontend: `api-client.js` (API methods), `utils.js` (helpers), `views/project-detail-dialogues.js` (dialogue modal renderer)

Key conventions: pure-data-transformation in renderer modules (no I/O), ES5 in all `public/` files, delegated click listeners for dynamic lists, `escapeHtml` before `marked` for XSS defence.

## Approach / Architecture

Group the work into three logical areas executed as separate steps:

1. **Code cleanup** (D-1, D-2, D-6, D-7, escapeHtml): Mechanical refactoring — hoist a constant, extract helpers, replace inline style, add single-quote escaping. No behavioral changes; existing tests must continue to pass.
2. **Test coverage** (D-3, D-4, D-5): Add new tests to close documented gaps. No production code changes.
3. **Documentation** (O-2): Audit and correct the `api-surface.md` API client table.

## Rationale

These are all small, low-risk improvements explicitly deferred from the prior project to keep that delivery cycle clean. Addressing them now prevents accumulation of technical debt while the context is fresh. The `parseQS` helper scope expanded from 3 to 13 repetitions during research, making it higher-value than initially estimated.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `parseJsonlContent` helper location | Private function in `chunk-renderer.ts` | Move to `chunk-accumulator.ts` as a public export | The helper is specific to the renderer's record format; `chunk-accumulator.ts` should stay focused on its current responsibilities. Keeping it private in the renderer is simpler and avoids expanding the accumulator's API surface. |
| `parseQS` scope | Extract a private `parseQueryString(url)` helper that returns `URLSearchParams` in `server.ts` | Leave the 13 repetitions as-is; or use a URL-parsing library | 13 repetitions is well past the threshold for extraction. A library is unnecessary — the 3-line pattern is trivial to extract as a private helper. |
| `INLINE_RESULT_TOOLS` location | Module-scope `const` in `chunk-renderer.ts` | Export from `chunk-accumulator.ts` | The set is rendering-specific (determines which tools show inline results vs. embedded `result` field). It doesn't belong in the accumulation layer. |

## Pattern Alignment

- **Pure-function module convention** — `chunk-renderer.ts` L19–20. All changes maintain the no-I/O, no-side-effects invariant.
- **ES5 in `public/` files** — All frontend changes use `var`, IIFEs, and no ES6+ features.
- **CSS class naming: `.dialogue-tool-*`** — The new `.dialogue-tool-detail-area` class follows the established prefix pattern in `styles.css`.
- **Test pattern: `mockFetch` + `vm.runInThisContext`** — New API client tests follow the established pattern in `api-client.test.ts`.

## Detailed Steps

### Step 1: Hoist `INLINE_RESULT_TOOLS` to module scope (D-1)

In `mcp-server/gui/chunk-renderer.ts`:

1. Add a module-scope constant after the imports (around L34):
   ```typescript
   /** Tools whose ToolMessage results are rendered inline (in detailLines) rather than embedded in a separate `result` field. */
   const INLINE_RESULT_TOOLS = new Set(['execute', 'task']);
   ```
2. Remove the local `const INLINE_RESULT_TOOLS = ...` from `buildToolResultIndex()` (L314).
3. Remove the local `const INLINE_RESULT_TOOLS = ...` from `renderMessagesToStructuredBlocks()` (L951).
4. Run existing tests — no behavioral change expected.

### Step 2: Extract `parseJsonlContent()` helper (D-2)

In `mcp-server/gui/chunk-renderer.ts`:

1. Add a private helper function after the imports:
   ```typescript
   /**
    * Shared JSONL pre-processing: splits raw content into lines, validates/skips
    * the chunk_format header, parses each data line via `parseChunkLine()`, and
    * returns the accumulated record array.
    *
    * Used by all three renderers to eliminate duplicated header-validation and
    * parse-loop boilerplate.
    */
   function parseJsonlContent(
     jsonlContent: string,
   ): Array<{ namespace: string[]; msg: Record<string, JsonValue> }> {
     const rawLines = jsonlContent.split('\n');
     const nonEmptyLines = rawLines.map(l => l.trim()).filter(Boolean);

     let dataLines: string[];
     if (nonEmptyLines.length === 0) {
       dataLines = [];
     } else {
       const firstLine = nonEmptyLines[0]!;
       dataLines = isValidHeader(firstLine)
         ? nonEmptyLines.slice(1)
         : nonEmptyLines;
     }

     const records: Array<{ namespace: string[]; msg: Record<string, JsonValue> }> = [];
     for (const line of dataLines) {
       const parsed = parseChunkLine(line);
       if (parsed) {
         records.push({ namespace: parsed.namespace, msg: parsed.msg });
       }
     }
     return records;
   }
   ```
2. Replace the duplicated boilerplate in `renderChunksToMarkdown()` (L206–235) with:
   ```typescript
   const records = parseJsonlContent(jsonlContent);
   ```
3. Replace the duplicated boilerplate in `renderChunksToDialogue()` (L793–822) with:
   ```typescript
   const records = parseJsonlContent(jsonlContent);
   ```
4. Replace the duplicated boilerplate in `renderChunksToStructured()` (L1068–1097) with:
   ```typescript
   const records = parseJsonlContent(jsonlContent);
   ```
5. Run existing tests — no behavioral change expected.

### Step 3: Extract `parseQueryString()` helper in server.ts (D-7)

In `mcp-server/gui/server.ts`:

1. Add a private helper before `matchRoute()`:
   ```typescript
   /**
    * Extracts query-string parameters from a full URL string.
    * Returns a URLSearchParams instance (empty if no query string present).
    */
   function parseQueryString(url: string): URLSearchParams {
     const qIdx = url.indexOf('?');
     return new URLSearchParams(qIdx !== -1 ? url.slice(qIdx + 1) : '');
   }
   ```
2. Replace all 13 occurrences of the 2–3 line pattern:
   ```typescript
   const qIdx = url.indexOf('?');
   const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
   const sp = new URLSearchParams(qStr);
   ```
   with:
   ```typescript
   const sp = parseQueryString(url);
   ```
   For the two `format`-only branches (L581–583, L973–975), replace:
   ```typescript
   const qIdx = url.indexOf('?');
   const qStr = qIdx !== -1 ? url.slice(qIdx + 1) : '';
   const format = new URLSearchParams(qStr).get('format');
   ```
   with:
   ```typescript
   const format = parseQueryString(url).get('format');
   ```
3. Run existing tests — no behavioral change expected.

### Step 4: Replace inline style with CSS class (D-6)

1. In `mcp-server/gui/public/styles.css`, add a new class after `.dialogue-tool-detail-line` (around L2310):
   ```css
   /* Always-visible wrapper for ↳ detail lines — sits between the toggle button and the collapsible body */
   .dialogue-tool-detail-area {
     padding: 0 12px 6px;
   }
   ```
2. In `mcp-server/gui/public/views/project-detail-dialogues.js` (L88), replace:
   ```javascript
   detailHtml += '<div style="padding: 0 12px 6px;">';
   ```
   with:
   ```javascript
   detailHtml += '<div class="dialogue-tool-detail-area">';
   ```
3. Run existing tests — no behavioral change expected.

### Step 5: Harden `escapeHtml` with single-quote escaping

In `mcp-server/gui/public/utils.js`, add a fifth `.replace()` call to `escapeHtml()` (after L23):
```javascript
.replace(/'/g, '&#x27;');
```

The full function becomes:
```javascript
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
```

Run existing tests — some tests that assert exact HTML output may need updating if they contain single quotes in expected strings.

### Step 6: Add route-level tests for `?format=structured` (D-3)

Create tests (either in a new file or by extending `mcp-server/tests/gui/dialogue-qa.test.ts`) that test the `matchRoute()` function directly for both:

1. **Deprecated route:** `GET /api/projects/:slug/chunks/:filename/rendered?format=structured` — verify the returned handler produces `{ blocks: [...] }` (not `{ content: string }`).
2. **Namespaced route:** `GET /api/projects/:repo/:slug/chunks/:filename/rendered?format=structured` — verify same.
3. **Default format (no param):** Both routes without `?format=structured` — verify `{ content: string }`.

This requires either:
- Mocking `handleGetChunkFile` to return known JSONL content, then asserting the response shape; or
- Importing `matchRoute` and verifying the returned handler is non-null and produces the correct response structure.

The most practical approach is to create a dedicated test file (e.g., `mcp-server/tests/gui/route-structured-format.test.ts`) that imports `matchRoute` from `server.ts` if it's exported, or tests via HTTP requests if the function is not exported. If `matchRoute` is not exported, export it as a named export for testing.

### Step 7: Add API client unit tests (D-4)

In `mcp-server/tests/gui/api-client.test.ts`, add a new `describe` block for chunk methods:

1. **`getChunkRendered(repo, slug, filename)`** — Mock fetch to return `{ content: 'rendered markdown' }`. Assert:
   - Fetch URL is `/api/projects/{repo}/{slug}/chunks/{filename}/rendered`
   - Return value is `'rendered markdown'` (extracted from `data.content`)
   - Parameters are URI-encoded

2. **`getChunkStructured(repo, slug, filename)`** — Mock fetch to return `{ blocks: [{ type: 'text', content: 'hello' }] }`. Assert:
   - Fetch URL includes `?format=structured`
   - Return value is the `blocks` array (extracted from `data.blocks`)
   - Parameters are URI-encoded

3 tests total (2 happy-path + 1 encoding check), following the existing `mockFetch` pattern in the file.

### Step 8: Add `_dialogueInlineMarkdown` regex fallback test (D-5)

In `mcp-server/tests/gui/project-detail-dialogues.test.ts`, add a test case:

1. Temporarily set `globalThis.marked` to `undefined`.
2. Call a function that exercises `_dialogueInlineMarkdown` (e.g., render a text block).
3. Assert that bold (`**text**` → `<strong>text</strong>`), italic (`*text*` → `<em>text</em>`), and code (`` `text` `` → `<code>text</code>`) are rendered via regex.
4. Assert that HTML entities are escaped (e.g., `<script>` → `&lt;script&gt;`).
5. Restore `globalThis.marked` after the test.

### Step 9: Audit `api-surface.md` API client table (O-2)

1. Read the API client table in `mcp-server/docs/agents/project-manifest/api-surface.md`.
2. Cross-reference every row against the current implementation in `mcp-server/gui/public/api-client.js`.
3. Note: `getChunkRendered` and `getChunkStructured` were already corrected by the prior project — those rows are already accurate and require no changes. This step is a full-table audit to find any remaining stale rows.
4. Known stale entries to fix:
   - `getRunLogs(slug)` — documented as 1-param; current implementation is 2-param: `(repo, slug)`.
   - `getRunLogEntries(slug, filename, afterLine?)` — documented as 3-param; current implementation is 4-param: `(repo, slug, filename, afterLine)`.

### Step 10: Update documentation manifests

Update the following files to reflect the changes made in this plan:

1. **`mcp-server/docs/agents/project-manifest/api-surface.md`** — If any public API signatures changed (they shouldn't — all changes are internal).
2. **`mcp-server/gui/docs/agents/project-manifest/ui-components.md`** — Add `.dialogue-tool-detail-area` class to the CSS class table.
3. **`mcp-server/gui/docs/agents/project-manifest/data-flows.md`** — If the `parseJsonlContent` helper warrants mention in the rendering pipeline flow.

## Dependencies

- Steps 1–5 are independent of each other and can be executed in any order.
- Steps 6–8 (test coverage) are independent of each other but should run after Steps 1–5 to test the post-refactoring state.
- Step 9 (documentation audit) is independent.
- Step 10 (manifest updates) must run last.

## Required Components

- `mcp-server/gui/chunk-renderer.ts` — Steps 1, 2
- `mcp-server/gui/server.ts` — Step 3; Step 6 (conditional: add named export for `matchRoute`)
- `mcp-server/gui/public/styles.css` — Step 4
- `mcp-server/gui/public/views/project-detail-dialogues.js` — Step 4
- `mcp-server/gui/public/utils.js` — Step 5
- `mcp-server/tests/gui/` — Steps 6, 7, 8 (new or extended test files)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Step 9
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Step 10

## Assumptions

- `matchRoute()` in `server.ts` can be exported for direct testing, or the route tests will use HTTP-level integration. The implementation agent should check exportability and choose accordingly.
- The `_dialogueInlineMarkdown` function is exercisable through `buildDialogueHTML` (since it's a module-private function called during text block rendering).
- No other code outside `mcp-server/gui/` references `INLINE_RESULT_TOOLS` or the duplicated JSONL boilerplate.

## Constraints

- Do not modify the logic of `buildToolResultIndex()` — only replace its local `INLINE_RESULT_TOOLS` const with a reference to the module-scope constant hoisted in Step 1; the function body is otherwise unchanged.
- All `public/` JS files must remain ES5 (no `const`, `let`, arrow functions, template literals).
- All changes must maintain backward compatibility — no behavioral changes to existing APIs.
- Pure-function invariant in `chunk-renderer.ts` must be preserved.

## Out of Scope

- Args search/filter for expanded tool call view (synthesis Next Steps #3) — feature work, not rework.
- Running `ctx-generate` (synthesis Next Steps #4) — operational task, not code change. The documentation step will note that `ctx-generate` should be run after merge.
- Any changes to `chunk-accumulator.ts` — the JSONL helper stays in the renderer.

## Acceptance Criteria

- AC-01: `INLINE_RESULT_TOOLS` is defined exactly once at module scope in `chunk-renderer.ts`; no local duplicates exist.
- AC-02: A single `parseJsonlContent()` private function replaces all three copies of the header-validation + parse-loop boilerplate; each renderer calls it instead.
- AC-03: A `parseQueryString()` private function replaces all 13 occurrences of the `indexOf('?') + URLSearchParams` pattern in `server.ts`.
- AC-04: The inline `style="padding: 0 12px 6px;"` in `project-detail-dialogues.js` is replaced by a `.dialogue-tool-detail-area` CSS class.
- AC-05: `escapeHtml()` in `utils.js` escapes single quotes (`'`) as `&#x27;`.
- AC-06: Automated tests exist for the `?format=structured` query parameter on both the deprecated and namespaced `/rendered` routes.
- AC-07: `getChunkRendered` and `getChunkStructured` in `api-client.js` have dedicated unit tests in `api-client.test.ts`.
- AC-08: The `_dialogueInlineMarkdown` regex fallback path (when `marked` is unavailable) has at least one test.
- AC-09: The API client table in `api-surface.md` is fully accurate: `getRunLogs` reflects its 2-param `(repo, slug)` signature, `getRunLogEntries` reflects its 4-param `(repo, slug, filename, afterLine)` signature, and all other rows are verified correct.
- AC-10: All existing tests pass with zero regressions after all changes.
- AC-11: Manifest documentation (`ui-components.md`) is updated to include `.dialogue-tool-detail-area`.

## Testing Strategy

All changes are covered by existing tests (for refactoring steps) plus new dedicated tests (for coverage gaps). The refactoring steps (1–5) must not change any observable behavior — the existing 3399+ tests serve as the regression safety net. The test-coverage steps (6–8) add new tests only.

## Test Plan

- `mcp-server/tests/gui/route-structured-format.test.ts` (new) — Tests `matchRoute()` for `?format=structured` on both deprecated and namespaced `/rendered` routes; tests default format (no param) on both routes. — AC-06
- `mcp-server/tests/gui/api-client.test.ts` (extended) — 3 new tests: `getChunkRendered` URL + return value, `getChunkStructured` URL + return value, URI encoding of params. — AC-07
- `mcp-server/tests/gui/project-detail-dialogues.test.ts` (extended) — 1 new test: `_dialogueInlineMarkdown` with `globalThis.marked = undefined`, asserting bold/italic/code regex transforms and HTML escaping. — AC-08
- Existing test suite (3399+ tests) — Full regression run after all changes. — AC-10

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Full audit: fix `getRunLogs` (1→2 params) and `getRunLogEntries` (3→4 params); verify all other rows. — AC-09
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `route-structured-format.test.ts` entry under `tests/gui/`.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Add `.dialogue-tool-detail-area` to CSS class table. — AC-11
- Note: Run `node scripts/cli.js ctx-generate` after merge to keep `.context/` snapshots current.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`escapeHtml` single-quote change breaks existing test assertions** | Review all test files that assert HTML output containing single quotes; update expected strings to use `&#x27;` where needed. Low risk — most test assertions use double-quoted HTML attributes. |
| **`parseQueryString` helper changes URL parsing behavior subtly** | The helper is a mechanical extraction of the exact same 3-line pattern. No logic change. Existing tests catch any deviation. |
| **`matchRoute` is not exported and cannot be tested directly** | If not exported, either add a named export (minimal change) or test via HTTP-level integration by starting the server in the test. The implementation agent should choose the approach that best fits the existing test infrastructure. |
| **`parseJsonlContent` extraction changes empty-input edge-case behavior** | All three renderers have identical boilerplate for empty input. The helper preserves the exact same logic. The 77+ existing chunk-renderer tests cover edge cases extensively. |
