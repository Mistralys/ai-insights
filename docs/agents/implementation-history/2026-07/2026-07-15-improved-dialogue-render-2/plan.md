# Plan

## Plan Audit Cycles
- Audits: 3 — Plan Auditor v1.5.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.0.0

## Prior Project Context
Two prior projects addressed dialogue rendering:
- **`2026-07-13-improved-dialogue-render`** introduced `renderChunksToDialogue()` — a compact chat-like Markdown renderer replacing the verbose JSON-heavy format in the GUI dialogue modal. Tool calls are shown as `Tool call: \`name\`` with `↳` detail lines instead of full JSON fenced blocks.
- **`2026-07-13-improved-dialogue-render-rework-1`** split `chunk-renderer.ts` into two co-located files (renderer + accumulator), fixed a pre-existing test failure, added summary truncation to `extractExecuteResult`, and documented the default-success behaviour.

Despite these improvements, the dialogue view still presents tool call data as flat Markdown text that cannot be interactively collapsed or expanded. Developers reviewing agent conversations are forced to scroll through numerous tool call entries that dominate the view, making it hard to follow the agent's reasoning flow. The project brief ([docs/agents/projects/improved-dialogue-render-2.md](docs/agents/projects/improved-dialogue-render-2.md)) explicitly calls for a VS Code Chat-style conversation view with collapsible tool calls.

The repository's strategic vision emphasises developer onboarding and friction reduction ("as easy as possible to set up and use"), making dialogue readability a priority.

## Summary
Transform the GUI dialogue modal from a flat Markdown rendering pipeline into an interactive, conversation-style view where agent text appears as clean paragraphs and tool calls are collapsed by default with expand/collapse controls. The server will provide structured JSON data alongside the existing Markdown endpoints, and the frontend will render interactive HTML directly — matching the UX pattern already established in the orchestrator queue view (▶/▼ toggle buttons).

## Architectural Context

### Current Pipeline
```
JSONL chunk file → accumulateChunks() → renderChunksToDialogue() → Markdown string
→ GET .../chunks/:filename/rendered → API.getChunkRendered() → marked.parse() → HTML in modal
```

**Key files:**
- [mcp-server/gui/chunk-accumulator.ts](mcp-server/gui/chunk-accumulator.ts) — shared parsing/accumulation layer; exports `MergedMessage`, `MergedToolCall`, `ContentBlock`, `accumulateChunks()`, and related types
- [mcp-server/gui/chunk-renderer.ts](mcp-server/gui/chunk-renderer.ts) — rendering layer; exports `renderChunksToMarkdown()` (verbose) and `renderChunksToDialogue()` (compact Markdown)
- [mcp-server/gui/server.ts](mcp-server/gui/server.ts) — route handler; `/rendered` endpoint calls `renderChunksToDialogue()` (lines 970, 583)
- [mcp-server/gui/public/views/project-detail-dialogues.js](mcp-server/gui/public/views/project-detail-dialogues.js) — frontend modal; fetches rendered Markdown, passes through `marked.parse()`, inserts into `.dialogue-markdown` div
- [mcp-server/gui/public/api-client.js](mcp-server/gui/public/api-client.js) — `getChunkRendered()` and `getChunkStructured()` (new) client methods
- [mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css) — dialogue modal and Markdown styling (lines 1998–2250)
- [mcp-server/tests/gui/chunk-renderer.test.ts](mcp-server/tests/gui/chunk-renderer.test.ts) — unit tests (77 tests)

### Frontend Constraints (from [gui/docs/agents/project-manifest/constraints.md](mcp-server/gui/docs/agents/project-manifest/constraints.md))
- **No build step** — all `.js`/`.css` served as-is
- **ES5-compatible JavaScript** — `var`, `function` declarations, string concatenation, `.then()` chains
- **IIFE module pattern** — globals via IIFEs, load order in `index.html` matters
- **CSS theming** — all colors via `var(--color-*)`, dark mode via `[data-theme="dark"]`

### Existing Expand/Collapse Patterns
The GUI already implements expand/collapse in two places:
1. **Orchestrator queue** ([views/orchestrator.js](mcp-server/gui/public/views/orchestrator.js), line ~291) — ▶/▼ toggle buttons with `expandedIds` state tracking
2. **Work package modal** ([views/project-detail-modal.js](mcp-server/gui/public/views/project-detail-modal.js), line ~88) — collapsible detail sections

## Approach / Architecture

### New Pipeline
```
JSONL chunk file → accumulateChunks() → renderChunksToStructured() → DialogueBlock[]
→ GET .../chunks/:filename/rendered?format=structured → JSON array
→ API.getChunkStructured() → buildDialogueHTML(blocks) → interactive HTML in modal
```

The approach introduces a **structured data format** as the bridge between backend accumulation and frontend rendering:

1. **Backend** (`chunk-renderer.ts`): Add a new public function `renderChunksToStructured()` that reuses the existing accumulation and tool-detail-line infrastructure but returns a typed JSON array of `DialogueBlock` objects instead of a Markdown string.

2. **API layer** (`server.ts`): The existing `/rendered` endpoint gains a `?format=structured` query parameter. When present, the response is a JSON array of `DialogueBlock` objects. Without it, behaviour is unchanged (Markdown string). This is backward-compatible: existing consumers (if any) continue to receive Markdown.

3. **Frontend** (`project-detail-dialogues.js`): The dialogue modal switches from `marked.parse(markdown)` to a new `buildDialogueHTML(blocks)` function that creates interactive HTML:
   - **Text blocks** → `<p>` elements (with inline Markdown rendered via `marked.parseInline()` for bold/italic/code)
   - **Tool call blocks** → collapsible rows: a clickable header showing `Tool call: name` with a ▶/▼ indicator; expanding reveals detail lines and optionally the full JSON args
   - **Subagent headings** → `<h3>` elements
   - **Checklist blocks** → `<ul>` with checkboxes

### DialogueBlock Type Schema

```typescript
type DialogueBlock =
  | { type: 'text'; content: string }
  | { type: 'tool-call'; name: string; details: string[]; args: unknown | null; result?: { content: string } }
  | { type: 'subagent-heading'; label: string }
  | { type: 'checklist'; items: Array<{ content: string; checked: boolean }> };
```

Key design choices:
- `tool-call` blocks include `args` (the parsed tool arguments object) so the frontend can optionally render full args in the expanded view — currently there is no way to see what arguments were passed to a tool call.
- `tool-call` blocks include an optional `result` field carrying the full ToolMessage content for tools NOT in the inline-result set (`execute`, `task`). For `execute` and `task`, the result is already inlined into the `details` array. For all other tools, the result was previously discarded entirely — now it is preserved inside the tool-call block and rendered in the expanded view. This self-contained design avoids fragile positional-adjacency pairing in a flat array (the structured renderer looks up results via the existing `buildToolResultIndex()` / `buildFullToolResultIndex()` correlation while emitting each tool-call block).
- `text` blocks contain raw text (not Markdown) — the frontend applies minimal inline formatting.

## Rationale

**Why structured JSON instead of enhanced Markdown?**
Markdown is inherently non-interactive. HTML `<details>` elements inside Markdown require the renderer to support raw HTML passthrough, and `marked` sanitises by default. Wrapping tool calls in `<!-- markers -->` and post-processing the `marked` output is fragile and couples the backend rendering to the frontend's DOM structure. A structured data format gives the frontend full control over interactivity while keeping the backend a pure data transformer.

**Why a query parameter on the existing endpoint?**
Adding `?format=structured` is simpler than a new route path, backward-compatible, and follows REST conventions for content negotiation. The existing Markdown format is retained as the default for any consumer that doesn't opt in.

**Why not return HTML from the server?**
The backend is a pure data transformation module (no I/O, no side effects). Generating HTML would violate this invariant and couple server code to CSS classes and DOM structure. The frontend is the right place for presentation logic.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Data format between server and frontend | Structured JSON array (DialogueBlock[]) | Enhanced Markdown with HTML `<details>` elements; Markdown with custom markers + post-processing | Structured JSON gives the frontend full control over interactivity without fragile DOM post-processing; Markdown approaches are brittle and limited |
| API surface change | `?format=structured` query param on existing endpoint | New `/rendered/structured` endpoint; Accept header content negotiation | Query param is simplest, backward-compatible, avoids route explosion; Accept header is over-engineered for a single-consumer GUI |
| Tool call result visibility | Embedded `result` field within `tool-call` blocks for non-inline tools | Separate `tool-call-result` block type in the flat array (positional adjacency pairing); always hidden (current); always visible | Embedding results inside their tool-call block is self-contained and robust — avoids fragile adjacency contracts where inserting a block between a tool call and its result would silently break pairing. The correlation data already exists via `buildToolResultIndex()`. |
| Frontend rendering library | Manual HTML construction (existing pattern) | React/Preact; Web Components; lit-html | No build step constraint eliminates any library that requires compilation; manual HTML matches all existing view modules |

## Pattern Alignment
- **IIFE module pattern** ([mcp-server/gui/public/views/orchestrator.js](mcp-server/gui/public/views/orchestrator.js)): the new frontend renderer follows the same `var` + IIFE pattern used by all other view modules.
- **Expand/collapse toggle** ([mcp-server/gui/public/views/orchestrator.js](mcp-server/gui/public/views/orchestrator.js), line ~310): reuses the ▶/▼ button convention already established for queue row expansion. **Intentional divergence:** The orchestrator uses an `expandedIds` state object and re-renders the entire table on every toggle click — this works because the orchestrator view polls for live updates, so re-rendering is already happening. The dialogue modal displays static content rendered once, so a full re-render per toggle would be wasteful. Instead, the plan uses direct DOM toggle (`hidden` attribute + `aria-expanded`) which is simpler and more appropriate for a static content modal.
- **Pure-function rendering** ([mcp-server/gui/chunk-renderer.ts](mcp-server/gui/chunk-renderer.ts)): `renderChunksToStructured()` follows the same pure-data-transformation pattern as the existing renderers — no I/O, no side effects.
- **Tool detail dispatcher** ([mcp-server/gui/chunk-renderer.ts](mcp-server/gui/chunk-renderer.ts), `getToolDetailLines()`): the structured renderer reuses the existing dispatcher and per-family formatters identically.
- **CSS theming** ([mcp-server/gui/public/styles.css](mcp-server/gui/public/styles.css)): all new styles use `var(--color-*)` custom properties with dark mode overrides.

## Detailed Steps

### Step 1: Define the DialogueBlock type and add `renderChunksToStructured()`

Add the `DialogueBlock` discriminated union type to `chunk-renderer.ts` and implement `renderChunksToStructured(jsonlContent: string): DialogueBlock[]`. This function:

1. Reuses the existing `accumulateChunks()` pipeline and correlation indexes (`buildToolCallIndex`, `buildToolResultIndex`).
2. Walks messages identically to `renderDialogueMessages()` but emits `DialogueBlock` objects instead of Markdown lines.
3. For AI messages: emits `{ type: 'text', content: textContent }` for text paragraphs.
4. For tool calls: emits `{ type: 'tool-call', name, details: string[], args, result? }` where `details` comes from the existing `getToolDetailLines()` dispatcher, `args` is the parsed arguments object, and `result` (if present) contains the ToolMessage content for non-inline tools. The result is looked up from the full result index during emission — no separate block type or adjacency tracking needed.
5. For `write_todos` tool calls: emits `{ type: 'checklist', items: [...] }` instead of generic tool-call lines.
6. For subagent headings: emits `{ type: 'subagent-heading', label }`.

**Expand the tool result index:** Currently `buildToolResultIndex()` only captures results for `execute` and `task` (the `INLINE_RESULT_TOOLS` set). For the structured renderer, a separate full-result index is needed that captures ALL ToolMessage results so they can be embedded as `result` fields within tool-call blocks. Add a new helper `buildFullToolResultIndex()` that has no tool-name filter.

**File:** `mcp-server/gui/chunk-renderer.ts`

### Step 2: Wire the `?format=structured` query parameter in `server.ts`

Modify the existing `/rendered` route handler in `server.ts` (lines ~956–970 and ~573–583) to check for a `format=structured` query parameter. When present:
- Call `renderChunksToStructured(content)` instead of `renderChunksToDialogue(content)`.
- Return `{ blocks: DialogueBlock[] }` instead of `{ content: string }`.
- Set the response `Content-Type` to `application/json`.

When the parameter is absent, behaviour is unchanged (returns `{ content: markdownString }`).

The query string must be parsed from `req.url` using `URL` or `URLSearchParams`. The existing route matching in `matchRoute()` strips the query string before segment splitting, so this requires accessing the raw URL in the handler closure.

**File:** `mcp-server/gui/server.ts`

### Step 3: Add `getChunkStructured()` to the API client

Add a new method to the API client IIFE in `api-client.js`:

```javascript
getChunkStructured: function (repo, slug, filename) {
  return _fetch(
    '/api/projects/' + encodeURIComponent(repo) + '/' +
    encodeURIComponent(slug) + '/chunks/' +
    encodeURIComponent(filename) + '/rendered?format=structured'
  ).then(function (data) { return data.blocks; });
}
```

This returns the `DialogueBlock[]` array directly.

**File:** `mcp-server/gui/public/api-client.js`

### Step 4: Build the interactive dialogue HTML renderer

Create a new frontend function `buildDialogueHTML(blocks)` in `project-detail-dialogues.js` that transforms the `DialogueBlock[]` array into an interactive HTML string. The function:

1. **Text blocks:** Renders content as `<div class="dialogue-text">`. Uses `marked.parseInline()` to support inline Markdown (bold, italic, code, links) within text content.

2. **Tool call blocks:** Renders as a collapsible row:
   ```html
   <div class="dialogue-tool-call">
     <button class="dialogue-tool-toggle" aria-expanded="false">
       <span class="dialogue-tool-arrow">▶</span>
       Tool call: <code>tool_name</code>
     </button>
     <div class="dialogue-tool-detail-line">↳ detail line</div>
     <div class="dialogue-tool-details" hidden>
       <pre class="dialogue-tool-args"><code>{ "arg": "value" }</code></pre>
     </div>
   </div>
   ```
   - The `↳` detail lines sit **outside** the collapsible `hidden` div, between the toggle button and the expandable area. They are always visible as the compact summary — matching the existing `renderChunksToDialogue()` behaviour where `↳` lines appear unconditionally.
   - The full `args` JSON is only shown when expanded.
   - If the tool-call block has a `result` field, it is rendered as a sub-section within the expanded area:
     ```html
     <div class="dialogue-tool-result">
       <span class="dialogue-tool-result-label">Result</span>
       <pre><code>result content</code></pre>
     </div>
     ```

3. **Checklist blocks:** Rendered as a `<ul class="dialogue-checklist">` with `<li>` items containing checkbox indicators (CSS-only, not interactive checkboxes).

4. **Subagent heading blocks:** Rendered as `<h3 class="dialogue-subagent-heading">Subagent: label</h3>`.

After building the HTML string and inserting it into the modal body, attach a delegated click listener on the modal body element that toggles `.dialogue-tool-toggle` buttons: swaps ▶/▼ text, toggles the `hidden` attribute on the sibling `.dialogue-tool-details` div, and updates `aria-expanded`.

**File:** `mcp-server/gui/public/views/project-detail-dialogues.js`

### Step 5: Switch the dialogue modal to use the structured renderer

Modify `_openDialogueModal()` in `project-detail-dialogues.js` to:

1. When `useChunks` is true (which is the primary path — chunks take priority), call `API.getChunkStructured()` instead of `API.getChunkRendered()`.
2. Pass the returned `blocks` array to `buildDialogueHTML(blocks)`.
3. Insert the resulting HTML directly into `.dialogue-modal-body` (no `marked.parse()` wrapper).
4. Attach the delegated click listener for tool call toggle buttons.
5. When `useChunks` is false (legacy Markdown dialogues), keep the existing `marked.parse()` path unchanged.

**File:** `mcp-server/gui/public/views/project-detail-dialogues.js`

### Step 6: Add CSS for the interactive dialogue view

Add new CSS rules to `styles.css` for the conversation-style dialogue elements:

- `.dialogue-text` — paragraph styling: `font-size: 14px`, `line-height: 1.65`, `margin-bottom: 12px`, `white-space: pre-wrap` to preserve intentional line breaks.
- `.dialogue-tool-call` — tool call container: subtle left border accent, `margin: 4px 0`, `padding: 4px 0`.
- `.dialogue-tool-toggle` — clickable header: `cursor: pointer`, no background, full-width, left-aligned, `font-size: 13px`, `color: var(--color-text-muted)`, hover state highlights. Styled similarly to the orchestrator queue toggle buttons.
- `.dialogue-tool-arrow` — `display: inline-block`, `width: 16px`, `text-align: center`, `transition: transform 0.15s`.
- `.dialogue-tool-details` — hidden content area: `padding-left: 20px`, `margin-top: 4px`, `font-size: 12px`.
- `.dialogue-tool-detail-line` — `↳` lines: `color: var(--color-text-muted)`, `font-size: 12px`.
- `.dialogue-tool-args` — `<pre>` for JSON args: `max-height: 300px`, `overflow-y: auto`, `font-size: 11px`, subtle background.
- `.dialogue-tool-result` — result container: lighter background, `border-left: 2px solid var(--color-border)`, `padding: 8px 12px`.
- `.dialogue-tool-result-label` — small uppercase label.
- `.dialogue-checklist` — styled `<ul>` with checkbox indicators.
- `.dialogue-subagent-heading` — `h3` with accent color border-bottom.
- Dark mode overrides for all new classes.

**File:** `mcp-server/gui/public/styles.css`

### Step 7: Add unit tests for `renderChunksToStructured()`

Add a new test suite in the existing test file `chunk-renderer.test.ts`:

- **Empty input** → returns `[]`.
- **Single AI text message** → returns `[{ type: 'text', content: '...' }]`.
- **AI message with tool calls** → returns text block + tool-call blocks with correct `name`, `details`, and `args`.
- **Tool call with execute result** → tool-call block's `details` includes the `↳` summary line; `result` field is absent (inline result already in details).
- **Tool call with non-inline result** → tool-call block includes `result: { content: '...' }` with the full ToolMessage content.
- **`buildFullToolResultIndex()` unit tests** → indexes results for non-inline tools; indexes results for inline tools too; skips messages without `tool_call_id`; handles empty namespace map.
- **write_todos tool call** → returns checklist block instead of generic tool-call block.
- **Subagent messages** → returns subagent-heading block followed by the subagent's content blocks.
- **Mixed conversation** → correct block ordering: text → tool-calls → text → tool-calls.
- **Malformed JSONL** → gracefully returns empty array.
- **ToolMessages for inline tools are consumed into `details`, not attached as `result`.**

**File:** `mcp-server/tests/gui/chunk-renderer.test.ts`

### Step 8: Update the cache-bust version in `index.html`

Increment the `?v=N` query string on the `project-detail-dialogues.js` and `styles.css` script/link tags in `index.html` to ensure browsers fetch the updated files.

**File:** `mcp-server/gui/public/index.html`

## Dependencies
- Step 2 depends on Step 1 (needs `renderChunksToStructured` export).
- Step 3 depends on Step 2 (needs the API endpoint to exist).
- Steps 4 and 6 are independent of Steps 1–3 (pure frontend work).
- Step 5 depends on Steps 3 and 4 (needs both the API client method and the HTML builder).
- Step 7 depends on Step 1 (tests the new function).
- Step 8 depends on Steps 4, 5, and 6 (ensures cache invalidation after frontend changes).

## Required Components
- `mcp-server/gui/chunk-renderer.ts` — new `DialogueBlock` type + `renderChunksToStructured()` function
- `mcp-server/gui/server.ts` — `?format=structured` query parameter handling
- `mcp-server/gui/public/api-client.js` — new `getChunkStructured()` method
- `mcp-server/gui/public/views/project-detail-dialogues.js` — `buildDialogueHTML()` + modal update
- `mcp-server/gui/public/styles.css` — new dialogue interaction styles
- `mcp-server/gui/public/index.html` — cache-bust version increment
- `mcp-server/tests/gui/chunk-renderer.test.ts` — new test suite

## Assumptions
- The `marked` library bundled in the GUI (`libs/marked.min.js`) exposes `marked.parseInline()` for inline Markdown rendering. If it does not, inline formatting within text blocks will use a simpler regex-based approach for bold/italic/code.
- The dialogue modal is the only consumer of the `/rendered` endpoint in the frontend. If other consumers exist, they are unaffected because the default format (no query param) remains Markdown.
- The `chunk-accumulator.ts` types (`MergedMessage`, `MergedToolCall`, `ContentBlock`) are sufficient to build the structured output — no changes to the accumulator are needed.

## Constraints
- **ES5 frontend** — all new JavaScript in `project-detail-dialogues.js` and `api-client.js` must use `var`, `function`, string concatenation, and `.then()` chains (no arrow functions, no template literals, no `let`/`const`).
- **No new dependencies** — no new npm packages for either backend or frontend.
- **Backward compatibility** — the existing `renderChunksToDialogue()` and `renderChunksToMarkdown()` functions and their API endpoints remain unchanged and fully functional.
- **Pure-function invariant** — `renderChunksToStructured()` must be a pure function (no I/O, no side effects), consistent with the existing renderers.

## Out of Scope
- Syntax highlighting for JSON in the expanded tool args view (could be added later with a lightweight highlighter).
- Keyboard navigation within the dialogue (Tab/Enter to expand/collapse tool calls).
- Search/filter within the dialogue view.
- Persistent expand/collapse state across modal opens.
- Changes to the `renderChunksToMarkdown()` verbose renderer.
- Changes to the Markdown-based dialogue fallback path (used when chunks are unavailable).

## Acceptance Criteria

- AC-01: `renderChunksToStructured()` is exported from `chunk-renderer.ts` and returns a `DialogueBlock[]` array for valid JSONL input.
- AC-02: The `DialogueBlock` type is a discriminated union with four variants: `text`, `tool-call` (with optional `result` field), `subagent-heading`, and `checklist`.
- AC-03: AI text content is emitted as `{ type: 'text' }` blocks with no JSON or tool call data mixed in.
- AC-04: Tool calls are emitted as `{ type: 'tool-call' }` blocks containing the tool name, detail lines from the existing dispatcher, and the parsed args object.
- AC-05: ToolMessage results for non-inline tools (not `execute`/`task`) are embedded as `result: { content: string }` within the corresponding `tool-call` block.
- AC-06: `write_todos` tool calls produce `{ type: 'checklist' }` blocks instead of generic tool-call blocks.
- AC-07: Subagent messages produce a `{ type: 'subagent-heading' }` block preceding the subagent's content blocks.
- AC-08: The `/rendered` endpoint returns `{ blocks: DialogueBlock[] }` when `?format=structured` is present, and `{ content: string }` when absent.
- AC-09: The frontend API client exposes `getChunkStructured(repo, slug, filename)` returning `DialogueBlock[]`.
- AC-10: The dialogue modal renders tool calls as collapsed-by-default interactive elements with a clickable header.
- AC-11: Clicking a tool call header toggles the expanded view showing detail lines, full args JSON, and (if present) the tool result.
- AC-12: Agent text appears as clean paragraphs without JSON noise or tool metadata.
- AC-13: The interactive dialogue view supports both light and dark themes via CSS custom properties.
- AC-14: All existing tests in `chunk-renderer.test.ts` continue to pass (backward compatibility).
- AC-15: New unit tests cover the `renderChunksToStructured()` function for all block types, edge cases, and empty input.
- AC-16: All frontend JavaScript follows ES5 patterns (no `let`/`const`, no arrow functions, no template literals).

## Testing Strategy

Testing is split across backend unit tests and manual frontend verification:

1. **Backend unit tests** (`chunk-renderer.test.ts`): Cover the `renderChunksToStructured()` function exhaustively — every block type, edge cases (empty input, malformed JSONL, truncated streams), and equivalence with the existing `renderChunksToDialogue()` output (the same tool calls that produce detail lines in Markdown should produce identical detail arrays in the structured output).

2. **Existing test regression**: All 77 existing tests for `renderChunksToMarkdown()` and `renderChunksToDialogue()` must continue to pass without modification.

3. **Manual frontend testing**: Open the GUI, navigate to a project with chunk data, open a dialogue modal, and verify:
   - Tool calls appear collapsed with ▶ indicator
   - Clicking expands to show detail lines, args JSON, and results
   - Agent text appears as clean paragraphs
   - Dark mode renders correctly
   - Legacy Markdown dialogues (no chunks) still render correctly

## Test Plan

- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "returns empty array for empty input" — AC-01
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "emits text block for AI message with text content" — AC-03
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "emits tool-call block with name, details, and args" — AC-04
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "embeds result in tool-call block for non-inline tool results" — AC-05
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "does not embed result for execute/task (inline results stay in details)" — AC-05
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "emits checklist block for write_todos" — AC-06
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "emits subagent-heading block before subagent content" — AC-07
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "handles malformed JSONL gracefully" — AC-01
- `chunk-renderer.test.ts` → `describe('renderChunksToStructured')` → "mixed conversation produces correct block ordering" — AC-03, AC-04
- `chunk-renderer.test.ts` → `describe('buildFullToolResultIndex')` → "indexes results for non-inline tools" — AC-05
- `chunk-renderer.test.ts` → `describe('buildFullToolResultIndex')` → "indexes results for inline tools too" — AC-05
- `chunk-renderer.test.ts` → `describe('buildFullToolResultIndex')` → "skips messages without tool_call_id" — AC-05
- `chunk-renderer.test.ts` → `describe('buildFullToolResultIndex')` → "handles empty namespace map" — AC-01
- `chunk-renderer.test.ts` → existing `describe('renderChunksToDialogue')` suite → all 77 tests pass unchanged — AC-14

## Documentation Updates

- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — Add `renderChunksToStructured()` signature and `DialogueBlock` type; document the `?format=structured` query parameter on the `/rendered` endpoint.
- `mcp-server/gui/docs/agents/project-manifest/data-flows.md` — Add a new section describing the structured dialogue rendering data flow (server → structured JSON → frontend HTML builder).
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — Update the `chunk-renderer.ts` annotation to mention the third public renderer.
- `mcp-server/gui/docs/agents/project-manifest/ui-components.md` — Document the new dialogue interaction components (collapsible tool calls, checklist rendering).
- `mcp-server/gui/docs/agents/project-manifest/constraints.md` — Add a note documenting the `?format=structured` dual-format endpoint pattern on the `/rendered` route as an API convention.

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **`marked.parseInline()` unavailable in the bundled version** | Check the bundled version at implementation time. If unavailable, use a simple regex for `**bold**`, `*italic*`, and `` `code` `` inline formatting — sufficient for agent text. |
| **Large dialogue files cause slow HTML rendering** | The structured format is a flat array of blocks — rendering is O(n) with no nested recursion. For very large files (>1000 blocks), consider lazy rendering (render visible blocks first, add more on scroll) as a follow-up. |
| **Tool call args may contain user-controlled content (XSS risk)** | All string values inserted into HTML must be escaped via `escapeHtml()` (already available as a global utility in the GUI). JSON args rendered in `<pre><code>` are doubly safe because `<pre>` content is already entity-escaped by the browser, but explicit escaping is still applied for defence-in-depth. |
| **Breaking the Markdown fallback path** | The `useChunks === false` path in `_openDialogueModal()` is left untouched — only the `useChunks === true` path switches to structured rendering. |
