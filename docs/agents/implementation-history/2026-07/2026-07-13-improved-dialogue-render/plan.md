# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: 3 — Plan Architect Reviewer v1.6.0

## Prior Project Context

The repository's strategic vision emphasises ease of use and minimal friction in daily developer
workflows (short-term) and a "Personas first" philosophy with LLM-independent tooling (long-term).
Recent projects have strengthened the GUI project-detail view with auto-updating and component
consolidation. This plan continues that quality trajectory by making the dialogue viewer more
readable — directly supporting the daily-usage friction goal.

---

## Summary

The orchestrator's chunk JSONL files capture the full raw LangGraph stream for each agent stage.
The current `renderChunksToMarkdown()` function in `mcp-server/gui/chunk-renderer.ts` renders
those files verbosely: every message is shown with a `## Role` heading, and every tool call is
expanded as a raw JSON fenced block. The result is hard to scan after the fact.

This plan introduces a new `renderChunksToDialogue()` function in the same file that renders the
same JSONL input in a clean, chat-like format: narrative text appears as plain paragraphs, tool
calls are shown as single-line `Tool call: \`name\`` entries with a minimal detail line, tool
results are hidden entirely (except for `execute`, where the abbreviated output is the most
valuable signal). The two active `/rendered` API endpoints in `server.ts` are updated to use the
new function, making the improved rendering the live experience in the GUI.

---

## Architectural Context

**Chunk pipeline:**

1. `orchestrator/src/utils/chunk_writer.py` — writes raw LangGraph `AIMessageChunk` and
   `ToolMessage` stream events to JSONL files at
   `{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl`.
2. `mcp-server/gui/chunk-renderer.ts` — pure TypeScript module that exports
   `renderChunksToMarkdown(jsonlContent: string): string`. It reassembles token-level chunk
   fragments by `msg.id`, groups messages by LangGraph namespace, and renders them to Markdown.
   Private helper `accumulateChunks()` does the accumulation; only the final rendering step
   needs to change for the new mode.
3. `mcp-server/gui/server.ts` — imports `renderChunksToMarkdown` (line 73) and calls it in two
   route handlers:
   - Line 582: deprecated `GET /api/projects/:slug/chunks/:filename/rendered`
   - Line 969: active `GET /api/projects/:repo/:slug/chunks/:filename/rendered`
4. GUI frontend `mcp-server/gui/public/views/work-package.js` — calls
   `API.getChunkRendered(repo, slug, filename)` which hits the namespaced route above; the
   response `{ content: string }` is rendered as Markdown in the WP dialogue panel.
5. Tests: `mcp-server/tests/gui/chunk-renderer.test.ts` — Vitest suite for `renderChunksToMarkdown`.
   New tests for `renderChunksToDialogue` will be added in the same file.

**Chunk JSONL wire format** (chunk_format: 1):
- Line 0: header `{ chunk_format: 1, stream_mode: "messages", langgraph_stream_version: "v2" }`
- Lines 1-N: `{ ns: string[], msg: AIMessageChunk.model_dump(), metadata: {} }` (or tuple shape).
  - `AIMessageChunk` messages have `type: "AIMessageChunk"`, `content` (text or content-block
    list), and `tool_call_chunks` (streamed partial tool call inputs).
  - `ToolMessage` messages have `type: "ToolMessage"`, `content` (result string), and
    `tool_call_id` (correlation id linking back to the AI message tool call).

---

## Approach / Architecture

Add a second exported function `renderChunksToDialogue(jsonlContent: string): string` to the
existing `mcp-server/gui/chunk-renderer.ts` file. All chunk parsing and accumulation logic is
**reused unchanged** via the existing private `accumulateChunks()` helper. Only the rendering
step differs.

The new renderer follows a three-pass approach on the accumulated message map:

1. **Index pass** — scan all AI messages across all namespaces to build a
   `toolCallId → toolName` lookup map, and scan all ToolMessages to build a
   `toolCallId → { toolName, content }` result map for any tool whose rendering
   rule needs inline results (currently `execute` and `task`). The result map is
   keyed by `toolCallId` and consumed in step 2.

2. **Render pass** — iterate messages per namespace in order:
   - `AIMessage` → render text content as plain paragraphs; render each tool call as a
     `Tool call: \`name\`` line with per-tool detail and, for `execute`, the abbreviated
     result appended inline.
   - `ToolMessage` → skip entirely (results already consumed in step 1, shown inline with
     their AI tool call for `execute`, hidden for all others).
   - Other message types (`HumanMessage`, `SystemMessage`) → skip silently (they are
     infrastructure noise in the current orchestrator output; the dialogue is AI-only).

3. **Emit** — return the assembled Markdown string. No document header, no role headings, no
   token-usage footer (these are useful in the verbose view but noise here).

**Per-tool rendering rules** (derived from the project specification document).
The rules are grouped into tool families; implementation should organise the
formatting logic by family (see Detailed Steps 1e) rather than as a single
monolithic dispatch block:

| Family | Tool pattern | Header | Detail line |
|---|---|---|---|
| File | `edit_file` | `Tool call: \`edit_file\`` | `↳ [filename](file_path)` |
| File | `write_file` | `Tool call: \`write_file\`` | `↳ [filename](file_path)` |
| File | `read_file` | `Tool call: \`read_file\`` | `↳ [filename](file_path)` |
| Execution | `execute` | `Tool call: \`execute\`` | `↳ \`abbreviated_command\`` + `↳ {last_meaningful_result_line} ✓/✗` |
| Task | `task` | `Tool call: \`task\`` | `↳ Sub-agent: **subagent_type**` + `↳ {first line of result}` |
| Todo | `write_todos` | `Tool call: \`write_todos\`` | Compact checklist (`- [x] / - [ ]`) |
| Search | `glob`, `grep`, `ls` | `Tool call: \`name\`` | _(no detail line)_ |
| Ledger mutation | `ledger_begin_work` | `Tool call: \`ledger_begin_work\`` | `↳ {wp_id} — {type} ({agent_role})` |
| Ledger mutation | `ledger_start_pipeline` | `Tool call: \`ledger_start_pipeline\`` | `↳ {wp_id} — {type} ({agent_role})` |
| Ledger mutation | `ledger_complete_pipeline` | `Tool call: \`ledger_complete_pipeline\`` | `↳ {wp_id} {type} → {status}` + first summary bullet |
| Ledger mutation | `ledger_cancel_pipeline` | `Tool call: \`ledger_cancel_pipeline\`` | `↳ {wp_id} {type} — {reason}` |
| Ledger mutation | `ledger_claim_work_package` | `Tool call: \`ledger_claim_work_package\`` | `↳ {wp_id} → {agent}` |
| Ledger mutation | `ledger_update_work_package_status` | `Tool call: \`ledger_update_work_package_status\`` | `↳ {wp_id} → {status}` |
| Ledger mutation | `ledger_update_pipeline_progress` | `Tool call: \`ledger_update_pipeline_progress\`` | `↳ {wp_id} {type} — {first summary item}` |
| Ledger mutation | `ledger_update_acceptance_criteria` | `Tool call: \`ledger_update_acceptance_criteria\`` | `↳ {wp_id} ({N} operations)` |
| Ledger mutation | `ledger_add_project_comment` | `Tool call: \`ledger_add_project_comment\`` | `↳ {type} ({priority}): {first line of note}` |
| Ledger query | `ledger_get_next_action` | `Tool call: \`ledger_get_next_action\`` | `↳ {agent_role}` |
| Ledger query | `ledger_get_work_package` | `Tool call: \`ledger_get_work_package\`` | `↳ {work_package_id}` |
| Ledger query | `ledger_get_handoff_status` | `Tool call: \`ledger_get_handoff_status\`` | `↳ {current_agent}` |
| Ledger query | `ledger_get_project_status` | `Tool call: \`ledger_get_project_status\`` | _(no detail)_ |
| Ledger query | `ledger_list_work_packages` | `Tool call: \`ledger_list_work_packages\`` | _(no detail)_ |
| Ledger query | `ledger_search_insights` | `Tool call: \`ledger_search_insights\`` | `↳ "{query}"` |
| Ledger (other) | other `ledger_*` | `Tool call: \`ledger_*\`` | _(no detail — tool still shown)_ |
| Default | Unknown / any other | `Tool call: \`name\`` | _(always shown, no detail)_ |

**`execute` result extraction:** Split the ToolMessage `content` by newlines. Remove the
`[Command succeeded with exit code N]` / `[Command failed with exit code N]` footer lines.
Take the last non-empty line as the summary. Append `✓` when the footer contains exit code 0,
`✗` otherwise. If content is empty or no meaningful line exists, omit the result line.

**`task` result extraction:** Take the first non-empty line of the ToolMessage `content` as
the summary. If content is empty, omit the result line.

**Result index scope:** The result index stores raw ToolMessage content for any tool whose
rendering rule consumes inline results — currently `execute` and `task`. Tool-specific
extraction logic (`extractExecuteResult` for `execute`, first-line extraction for `task`) is
applied by `getToolDetailLines()` at render time, not during index construction. This keeps
the index general-purpose so future tools that need inline results only require adding a new
family formatter — not changing the index.

The new function is then wired into `server.ts` by updating the import and both `/rendered`
handler calls to use `renderChunksToDialogue` instead of `renderChunksToMarkdown`. The old
export is retained (not removed) so it remains available for debugging and for any future
consumer that needs the verbose format.

---

## Rationale

Replacing the existing `/rendered` endpoint output directly (rather than adding a parallel
`/dialogue` endpoint) keeps the change minimal and immediately visible in the GUI without any
frontend routing changes. The `work-package.js` view already renders whatever Markdown the
`/rendered` endpoint returns; no client-side changes are needed.

Keeping `renderChunksToMarkdown` as an unchanged export respects the stable-API convention and
leaves the verbose format available without a migration cost.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|---|---|---|---|
| New function vs. modify existing | New `renderChunksToDialogue` alongside `renderChunksToMarkdown` | Single function with a `mode` parameter | Separate functions have cleaner signatures and separate test surfaces; no mode-dispatch complexity |
| Replace or augment `/rendered` endpoint | Replace (swap `renderChunksToDialogue` in both callers) | Add a new `/dialogue` endpoint, keep `/rendered` unchanged; add a `?format=` query parameter | Replacing avoids dead-route accumulation and surfaces the improvement immediately in the GUI; the old export is available if needed. The verbose renderer remains exported from `chunk-renderer.ts` for debugging and tests — losing a server-route debug path is acceptable because the verbose format is a developer diagnostic, not a user-facing contract. |
| Correlation strategy for execute results | Pre-pass `toolCallId → result` map | Two-pass sequential scan | Pre-pass is O(N) in messages, avoids stateful per-message lookahead, and is easier to test |
| Result index scope | General `buildToolResultIndex` storing raw content for `execute` and `task` | Execute-only index; separate per-tool result paths | A general index avoids special-casing and scales to future tools that need inline results; the tool-specific extraction is deferred to the render step, keeping the index simple |
| ToolMessage visibility | Hide all (results consumed inline for `execute` and `task`, hidden for all others) | Show all (verbose), show a subset | Hiding results matches IDE chat conventions; `execute` and `task` results are the only ones with actionable diagnostic content, and they are shown inline with their tool call rather than as standalone ToolMessage blocks |
| Tool formatter shape | Per-family helper functions (`formatFileToolDetail`, `formatExecuteDetail`, etc.) coordinated by a thin `getToolDetailLines()` dispatcher | Single monolithic dispatch block; external formatter registry in a separate file | Family helpers keep related formatting logic co-located, prevent a 20+ case dispatch from becoming the hardest part of the module to scan, and require no new files or abstractions |

---

## Pattern Alignment

| Pattern | This plan | Reference |
|---|---|---|
| Pure data transformation in `chunk-renderer.ts` | Followed — `renderChunksToDialogue` is a pure function with no I/O | `mcp-server/gui/chunk-renderer.ts` module-level docstring |
| Reuse private accumulation logic | Followed — `accumulateChunks()` called identically | existing `renderChunksToMarkdown()` call site |
| Single export per public function | Followed — one new named export | existing `export function renderChunksToMarkdown` |
| Generic renderer shape | Followed — `getToolDetailLines()` delegates to per-family helpers rather than embedding domain logic in the message walker | existing `renderToolCalls()` helper pattern in `chunk-renderer.ts` |
| Test file co-location | Followed — tests in `mcp-server/tests/gui/chunk-renderer.test.ts` | existing test file |
| Manifest maintenance | Followed — api-surface.md, file-tree.md updated | `mcp-server/docs/agents/project-manifest/` |

---

## Detailed Steps

1. **Add `renderChunksToDialogue()` to `mcp-server/gui/chunk-renderer.ts`**

   a. Add private helper `buildToolCallIndex(nsMap)` — iterates all AI messages across all
      namespaces and returns `Map<toolCallId, toolName>`.

   b. Add private helper `buildToolResultIndex(nsMap, toolCallIndex)` — iterates all
      ToolMessages across all namespaces, looks up each `tool_call_id` in `toolCallIndex`,
      and stores the raw ToolMessage `content` for any tool whose rendering rule needs
      inline results (currently `execute` and `task`). Returns
      `Map<toolCallId, { toolName: string; content: string }>`. Tool-specific extraction
      (abbreviated output line for `execute`, first line for `task`) is deferred to the
      rendering step in `getToolDetailLines()`.

   c. Add private helper `abbreviateCommand(command: string): string` — strips the leading
      `cd … &&` prefix when present, takes the first meaningful command token, and truncates
      to ≤ 80 characters with `…` if needed.

   d. Add private helper `extractExecuteResult(content: string): { summary: string; success: boolean } | null` — extracts the last meaningful output line and exit-code success flag from
      a ToolMessage `content` string.

   e. Add private helper `getToolDetailLines(name: string, args: unknown, resultEntry?: { toolName: string; content: string }): string[]` — returns 0–N `↳ …` detail lines for a
      given tool call. Delegates to per-family formatter helpers rather than a monolithic
      dispatch block:
      - `formatFileToolDetail(args)` — handles `edit_file`, `write_file`, `read_file`.
      - `formatExecuteDetail(args, resultEntry)` — handles `execute` (calls
        `extractExecuteResult` on the raw result content).
      - `formatTaskDetail(args, resultEntry)` — handles `task` (extracts first result line).
      - `formatLedgerToolDetail(name, args)` — handles all `ledger_*` tools (mutation and
        query families).
      - Default: returns empty array (tool header is always emitted by the caller).

      This family-helper structure keeps future tool additions local and prevents
      `getToolDetailLines()` from becoming a maintenance hotspot as new tools are added.

   f. Add private helper `renderDialogueMessages(messages: MergedMessage[], toolResultIndex: Map<string, { toolName: string; content: string }>): string[]` — iterates messages, skips
      non-AI message types, renders text content as paragraphs, renders tool calls using
      `getToolDetailLines()`, and skips ToolMessages.

   g. Add exported function `renderChunksToDialogue(jsonlContent: string): string` — calls
      `accumulateChunks()`, builds the tool-call index and tool-result index via
      `buildToolCallIndex()` and `buildToolResultIndex()`, calls
      `renderDialogueMessages()` per
      namespace in the same main-first / sub-agents-next order as `renderChunksToMarkdown`,
      joins the output, and returns the Markdown string (always ends with `\n`).
      If the accumulated map is empty, returns `*No dialogue recorded.*\n`.

2. **Export `renderChunksToDialogue` from `mcp-server/gui/chunk-renderer.ts`**
   - Add the `export` keyword to the function declaration.
   - Do **not** modify `renderChunksToMarkdown` or any existing private helpers.

3. **Update `mcp-server/gui/server.ts`**
   - Change the import on line 73 to import only `renderChunksToDialogue` (the old
     `renderChunksToMarkdown` is no longer called from `server.ts` after the swap; it remains
     exported from `chunk-renderer.ts` for debugging and tests):
     `import { renderChunksToDialogue } from './chunk-renderer.js';`
   - Update line 582 (deprecated route handler): replace
     `renderChunksToMarkdown(content)` with `renderChunksToDialogue(content)`.
   - Update line 969 (active namespaced route handler): replace
     `renderChunksToMarkdown(content)` with `renderChunksToDialogue(content)`.

4. **Add tests in `mcp-server/tests/gui/chunk-renderer.test.ts`**
   - Import `renderChunksToDialogue` alongside the existing import.
   - Add a new top-level `describe('renderChunksToDialogue …')` block with sub-describes for
     each test group listed in the Test Plan section.

5. **Update manifest documentation**
   - `mcp-server/docs/agents/project-manifest/api-surface.md` — add `renderChunksToDialogue`
     to the `chunk-renderer.ts` section.
   - `mcp-server/docs/agents/project-manifest/file-tree.md` — update the annotation on
     `chunk-renderer.ts` to mention both exported functions.
   - `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add
     `renderChunksToDialogue` to the `chunk-renderer.ts` section and note the update to
     the `/rendered` endpoint.
   - `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — update the `chunk-renderer.ts`
     line count annotation (approximate new size) and the description.

---

## Dependencies

- No new npm dependencies — the implementation uses only existing TypeScript types and helpers
  already present in `chunk-renderer.ts`.
- `accumulateChunks()` must remain private and unmodified (the new function is additive).

---

## Required Components

**Modified files:**

- `mcp-server/gui/chunk-renderer.ts` — new private helpers + new exported function
- `mcp-server/gui/server.ts` — updated import + two call sites
- `mcp-server/tests/gui/chunk-renderer.test.ts` — new test block

**Documentation files (updates only):**

- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md`
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md`

---

## Assumptions

- The chunk JSONL format (chunk_format: 1) is stable and will not change during this work.
- `ToolMessage.tool_call_id` correlates reliably with a preceding AI message `tool_call.id`.
- Narrative text and tool calls always arrive in AI messages (not in ToolMessages or
  HumanMessages), which is consistent with the current LangGraph + Anthropic streaming
  behaviour observed in the orchestrator.
- Sub-agent namespace messages in chunk files follow the same `type` conventions as main-agent
  messages.
- The GUI frontend does not require changes because the `/rendered` endpoint continues to return
  `{ content: string }` (Markdown) — only the Markdown content changes.

---

## Constraints

- `renderChunksToMarkdown` must remain exported and functionally unchanged (backward compatibility).
- `accumulateChunks()` must not be modified.
- The new function must be a pure function: no I/O, no side effects, no external state.
- Cross-platform: no OS-specific APIs; TypeScript only (aligns with the existing file).
- `chunk-renderer.ts` lives in `mcp-server/gui/` and therefore must not import from
  `mcp-server/src/` (gui layer separation).

---

## Out of Scope

- Changes to `orchestrator/src/utils/chunk_writer.py` or the JSONL format.
- Changes to the GUI frontend beyond what the updated Markdown content naturally provides.
- Changes to `dialogue_writer.py` (deprecated, manual-use only).
- A UI "toggle" between verbose and dialogue view (not requested).
- `scripts/read-log.js` (that tool reads the orchestrator JSONL run logs, not chunk files).
- Changelogs (the Engineer handles those as part of the release step).

---

## Acceptance Criteria

- `renderChunksToDialogue('')` returns a non-empty string ending in `\n` (graceful empty input).
- A chunk file containing only text-bearing AI messages renders all text as plain paragraphs with
  no `## Role` headings.
- An `edit_file` tool call renders as `Tool call: \`edit_file\`\n↳ [filename](/path)` with no
  JSON block.
- An `execute` tool call renders the abbreviated command and the last meaningful output line from
  its ToolMessage result.
- A non-`execute` ToolMessage produces no visible output in the rendered Markdown.
- A `write_todos` tool call renders as a compact checklist with status indicators.
- A `task` tool call renders the sub-agent type and first line of the collapsed result.
- `glob`, `grep`, and `ls` tool calls render only `Tool call: \`name\`` with no detail.
- All `ledger_*` tools render with contextual summaries matching the per-tool spec table.
- Unknown tools render with just `Tool call: \`name\`` (always visible).
- Sub-agent namespaces are still separated and labelled (e.g. `### Subagent: …`).
- Both `GET /api/projects/:slug/chunks/:filename/rendered` (deprecated) and
  `GET /api/projects/:repo/:slug/chunks/:filename/rendered` (active) return dialogue-formatted
  Markdown.
- All existing `renderChunksToMarkdown` tests continue to pass unchanged.
- `renderChunksToMarkdown` continues to produce verbose Markdown output (no regression).

---

## Testing Strategy

All tests are pure unit tests in `mcp-server/tests/gui/chunk-renderer.test.ts`. They use the
same JSONL builder helpers already defined in that file (`chunkLine`, `aiChunk`,
`aiChunkWithToolCall`, `toolResultMsg`, `jsonl`, `HEADER`). No additional test infrastructure
or real filesystem I/O is required — `renderChunksToDialogue` is a pure function.

---

## Test Plan

- `renderChunksToDialogue — empty input / returns non-empty string for empty JSONL` — asserts
  result is a non-empty string ending with `\n` — covers AC: graceful empty input.

- `renderChunksToDialogue — empty input / returns no-messages sentinel for empty JSONL` — asserts
  result contains `*No dialogue recorded.*` — covers AC: graceful empty input.

- `renderChunksToDialogue — text rendering / renders AI text content as plain paragraphs` —
  single AI message with text; asserts text is present and no `## Assistant` heading —
  covers AC: plain paragraphs, no role headings.

- `renderChunksToDialogue — text rendering / skips HumanMessage and SystemMessage` — human and
  system chunks present; asserts neither role heading nor content appears — covers AC: AI-only
  dialogue output.

- `renderChunksToDialogue — file tools / edit_file renders with file link and no JSON` — AI
  message with `edit_file` tool call; asserts `Tool call: \`edit_file\`` and `↳` line with
  filename; asserts no `\`\`\`json` block — covers AC: `edit_file` rendering.

- `renderChunksToDialogue — file tools / write_file renders with file link` — same as above for
  `write_file` — covers AC: `write_file` rendering.

- `renderChunksToDialogue — file tools / read_file renders with file link` — same for `read_file`
  — covers AC: `read_file` rendering.

- `renderChunksToDialogue — execute tool / renders abbreviated command` — AI message with
  `execute` tool call; asserts the abbreviated command appears in a `↳ \`…\`` line — covers
  AC: execute command rendering.

- `renderChunksToDialogue — execute tool / appends last output line with success tick` —
  ToolMessage result with exit code 0; asserts the last meaningful output line and `✓` appear
  — covers AC: execute result rendering (success).

- `renderChunksToDialogue — execute tool / appends last output line with failure tick` —
  ToolMessage result with non-zero exit code; asserts `✗` — covers AC: execute result rendering
  (failure).

- `renderChunksToDialogue — tool results hidden / non-execute ToolMessage produces no output` —
  AI message with `read_file` tool call + matching ToolMessage; asserts ToolMessage content is
  absent — covers AC: ToolMessage suppression.

- `renderChunksToDialogue — write_todos tool / renders compact checklist` — AI message with
  `write_todos` call; asserts checklist items with `- [x]` / `- [ ]` markers and status labels
  — covers AC: `write_todos` rendering.

- `renderChunksToDialogue — task tool / renders sub-agent type and collapsed result` — AI message
  with `task` call + ToolMessage; asserts `Sub-agent:` label and first result line — covers AC:
  `task` rendering.

- `renderChunksToDialogue — minimal tools / glob, grep, ls render name only` — one call each;
  asserts header line present, no `↳` detail line — covers AC: glob/grep/ls rendering.

- `renderChunksToDialogue — ledger workflow tools / ledger_begin_work renders WP, type, role` —
  covers AC: ledger tool contextual summaries.

- `renderChunksToDialogue — ledger workflow tools / ledger_complete_pipeline renders WP, type,
  status, first summary item` — covers AC: ledger tool contextual summaries.

- `renderChunksToDialogue — ledger query tools / ledger_get_next_action renders agent_role` —
  covers AC: ledger tool contextual summaries.

- `renderChunksToDialogue — ledger query tools / ledger_get_project_status renders header only`
  — covers AC: ledger tool (no-detail variant).

- `renderChunksToDialogue — unknown tool / renders Tool call header and is always visible` —
  covers AC: unknown tool rendering.

- `renderChunksToDialogue — token merging / reassembles multi-chunk tool call args correctly` —
  two `AIMessageChunk` lines with same `id` and partial `input_json_delta`; asserts tool call is
  rendered correctly — covers AC: downstream reassembly unchanged.

- `renderChunksToDialogue — sub-agents / renders sub-agent block with namespace label` — chunk
  with non-empty namespace; asserts `### Subagent:` heading — covers AC: sub-agent labelling.

- `renderChunksToDialogue — regression / does not affect renderChunksToMarkdown output` — runs
  both functions on the same input; asserts outputs differ and `renderChunksToMarkdown` still
  contains `## Assistant` — covers AC: no regression on existing function.

---

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — add `renderChunksToDialogue`
  signature and description to the `chunk-renderer.ts` section.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — update `chunk-renderer.ts`
  annotation to list both exports.
- `mcp-server/gui/docs/agents/project-manifest/api-surface.md` — add `renderChunksToDialogue`
  to the exports table; update the `/rendered` endpoint description to reference the dialogue
  renderer.
- `mcp-server/gui/docs/agents/project-manifest/file-tree.md` — update the `chunk-renderer.ts`
  line count and description.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Chunk files from older runs may have unexpected tool types** | Unknown tools fall through to the "always show, no detail" branch — no crash, no hidden output. |
| **`execute` content format may vary across platforms or versions** | `extractExecuteResult()` is lenient: it scans for the `[Command` footer pattern and falls back to omitting the result line if the pattern is absent. |
| **Partial/truncated chunk files (retry artefacts)** | `accumulateChunks()` already handles this gracefully (malformed lines are skipped); the new function inherits that behaviour. |
| **Sub-agent ToolMessages may use different `tool_call_id` correlation** | The pre-pass indexes are built across all namespaces, so cross-namespace correlation is handled correctly. |
| **Existing tests break on `server.ts` changes** | `renderChunksToMarkdown` is unchanged; existing tests that call it directly are unaffected. Integration tests that hit the `/rendered` endpoint will see different Markdown but the structural contract (`{ content: string }`) is preserved. |
