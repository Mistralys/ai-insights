# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Summary

This plan delivers two tightly related features that share the same goal — making LangGraph agent dialogue readable without parsing raw JSONL:

1. **CLI extraction script** (`scripts/extract-dialogue.js`): A standalone Node.js script that reads chunk `.jsonl` files, assembles the streaming message fragments into complete prose turns, and writes a Markdown `.md` file alongside the source. Supports single-file and directory batch modes. Callable by the Orchestrator Archaeologist and developers directly.

2. **GUI "Text Only" tab**: When viewing a dialogue chunk in the MCP Server GUI, the dialogue modal gains a two-tab layout — **Detailed** (the current interactive structured view) and **Text Only** (extracted prose). The text is fetched from a new backend endpoint that either reads an existing cached `.md` file or extracts and writes one on first access. Both the CLI and the GUI produce the same `.md` format, so either can prime the cache.

The Archaeologist persona source is updated to replace the "(future)" placeholder with a concrete reference to both tools.

---

## Architectural Context

The orchestrator saves one JSONL chunk file per agent stage run under `{slug}/orchestrator/chunks/`. Each file is a stream of LangGraph `AIMessageChunk` and `ToolMessage` objects serialized as JSONL. The streaming nature means a single AI response turn is split across dozens to hundreds of lines, and tool call arguments are fragmented into `input_json_delta` partial-JSON strings. The files are currently analysed by the Orchestrator Archaeologist by reading raw lines — a laborious process.

The MCP Server GUI already has a rich chunk-viewing facility: `mcp-server/gui/chunk-renderer.ts` contains `renderChunksToMarkdown()`, `renderChunksToDialogue()`, and `renderChunksToStructured()` — pure rendering functions that accumulate streaming fragments into merged messages and produce human-readable output. These are served via the `GET /api/projects/:repo/:slug/chunks/:filename/rendered` endpoint in `server.ts`. The existing dialogue modal in `project-detail-dialogues.js` uses the structured renderer to produce an interactive view with collapsible tool-call cards.

CLI scripts follow the pattern established by `scripts/read-log.js`: pure Node.js ESM, stdlib-only, CLI-first with a `--help` flag, invokable via `node scripts/<name>.js` or through `scripts/cli.js`.

---

## Approach / Architecture

The solution has two interacting parts that share the same `.md` output format:

### Part 1 — CLI extraction script (`scripts/extract-dialogue.js`)

A standalone Node.js ESM script that accepts a chunk file path or directory. It:
1. Parses each JSONL chunk file in a single pass, assembling streaming fragments by run ID and tool-call index into complete turns.
2. Separates dialogue by namespace depth: outer/sole agent (`ns.length === 0`, empty namespace array) and inner agent (`ns.length > 0`). Single-depth files render flat; dual-depth files render two labelled sections.
3. Outputs **prose text only** (no tool-call JSON, no tool results) — the agent's reasoning in readable paragraphs.
4. Writes a `.md` file in the same directory as the source `.jsonl` (same base name). Skips existing files unless `--force` is passed.

### Part 2 — GUI "Text Only" tab

The dialogue modal in `project-detail-dialogues.js` gains a tab bar (only when `useChunks === true`):
- **Detailed** tab: the existing structured block renderer (interactive, tool-call toggles). Default active.
- **Text Only** tab: prose-only Markdown view, lazily loaded on first tab click.

The backend serves the "Text Only" content via a new endpoint `GET /api/projects/:repo/:slug/chunks/:filename/text` that:
1. Checks for an existing `.md` file next to the `.jsonl` in the chunk directory.
2. If found (CLI pre-generated or prior GUI access): reads and returns it directly.
3. If not found: calls the new `renderChunksToText()` renderer (TypeScript, server-side), writes the `.md` file as a side-effect (best-effort caching), and returns the content.

This design means the CLI and the GUI share the same cache file — whichever runs first primes it for the other.

### Shared `.md` output format

Both the CLI and the server-side `renderChunksToText()` produce the same format: plain prose paragraphs only (AI text content), no tool calls. For dual-namespace files, sections are labelled:
```markdown
## Outer Agent

<prose>

## Inner Agent

<prose>
```
For single-namespace files: no section headers, just prose paragraphs.

---

## Rationale

**CLI approach:** Placing the extractor in `scripts/` alongside `read-log.js` keeps it discoverable and consistent. Writing `.md` files alongside `.jsonl` files (same directory, same base name) makes it trivially easy to open the readable version without a separate output path. Assembling streaming chunks in a single pass is sufficient — the files are small enough to fit in memory.

**GUI tab approach:** Adding a second tab to the existing modal is the least disruptive UI change — the Detailed view is unchanged. Lazy-loading the text tab means no extra network request for users who never need it. Caching as a `.md` file means repeated access is instant and the file is also available from the CLI.

**Shared `.md` format:** A prose-only output (no tool-call JSON) is the right content for "Text Only" — it serves the debugging use case of reading the agent's actual reasoning, not its tool invocations (which the Detailed tab already shows). The CLI and GUI write the same format so the cache is cross-tool compatible.

**Server-side renderer vs. CLI sharing code:** The server-side `renderChunksToText()` lives in TypeScript and cannot be imported by the standalone Node.js CLI script without a build step. Both implement the same algorithm independently. The format contract (described above) ensures compatible output.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Output location | `.md` alongside `.jsonl` (same dir, same stem) | Separate `--output-dir`, stdout | Co-location makes it obvious; stdout would not save files as required; separate dir adds indirection |
| Text only content | Prose text only (no tool calls) | Full dialogue (text + tool summaries) | "Text Only" should be the agent's reasoning, not its tool calls; Detailed tab already covers the full interactive view |
| Inner/outer rendering | Separate sections when both depths present | Always separate, always merged | Merged output for single-depth files avoids empty sections; dual-depth files genuinely have two distinct agent levels |
| Arg assembly in CLI | Index-based accumulation of `tool_call_chunks[].args` | Use `msg.tool_calls[].args` from final chunk | Index-based approach verified correct on real data; `tool_calls.args` remains `{}` throughout streaming |
| CLI skip/overwrite default | Skip existing `.md` by default, `--force` to overwrite | Always overwrite | Skipping protects hand-annotated output; `--force` provides an easy override |
| CLI registration in cli.js | `helpHidden: true`, `key: null` | Interactive menu entry | Matches the `read-log` pattern for secondary tooling; not needed in the main interactive menu |
| GUI tab placement | Below header, above body (separate `.dialogue-modal-tabs` div) | Tabs inside header; content-toggle buttons | Keeps header clean (title + close always visible); tab bar is its own layout row consistent with standard tab UI patterns |
| GUI text loading | Lazy (fetched on first tab click) | Eager (fetch both tabs on modal open) | Lazy avoids a wasted request when user only needs the Detailed view (the common case) |
| Server-side `.md` write | Best-effort (ignore write errors, always return content) | Hard-fail on write error | Write errors (permissions, disk) should not break the read path; content is always returned regardless |
| Code sharing between CLI and server | Independent implementations sharing a format contract | CLI imports from compiled dist | The compiled dist may be stale; an independent pure-JS implementation avoids build coupling |

---

## Pattern Alignment

| Pattern | Alignment |
|---------|-----------|
| `#!/usr/bin/env node` + ESM `import` | Follows `scripts/read-log.js` exactly |
| `WORKSPACE_ROOT = path.resolve(import.meta.dirname, '..')` | Follows `scripts/read-log.js` exactly |
| TTY-gated ANSI colors via `USE_COLOR = process.stdout.isTTY` | Follows `scripts/read-log.js` exactly |
| `parseArgs(argv)` helper function | Follows `scripts/read-log.js` style (no external deps) |
| `parseJsonl(filePath)` helper with silent line-skip | Reuses `scripts/read-log.js` approach |
| `COMMANDS` array entry with `category: 'Orchestrator'`, `key: null`, `helpHidden: true` | Follows `read-log` command entry in `scripts/cli.js` |
| No mutation of source chunk `.jsonl` files | Follows Archaeologist constraint: read-only forensic tool |
| `path.join()` / `path.resolve()` only — no string-joined paths | Follows workspace cross-platform policy |
| `renderChunksToText()` — pure data transformation, no I/O, exported from `chunk-renderer.ts` | Follows `renderChunksToMarkdown`, `renderChunksToDialogue`, `renderChunksToStructured` in same file |
| `handleGetChunkText()` — `assertSafeSlug` + `CHUNK_FILENAME_RE` + `resolveProjectStore` + path prefix check | Follows `handleGetChunkFile()` in `mcp-server/gui/api.ts` |
| Server route at `rest.length === 6, rest[5] === 'text'` with `rest[2] !== 'chunks'` exclusion | Follows existing `/rendered` route pattern in `server.ts` |
| Frontend ES5 style: `var`, `function`, `.then()` | Follows `api-client.js` and `project-detail-dialogues.js` exactly |
| Tab HTML built as string with `escapeHtml()` | Follows modal HTML construction pattern in `_openDialogueModal()` |
| Version query string bump on `index.html` script tags | Follows cache-busting convention in `index.html` |

---

## Detailed Steps

### Part 1 — Server-side `renderChunksToText()` renderer

1. **Add `renderChunksToText()` to `mcp-server/gui/chunk-renderer.ts`**:
   - Add a private helper `extractTextFromMessages(messages: MergedMessage[]): string` that iterates AI messages (type `ai`/`aimessage`/`aimessagechunk`), calls `renderContent(msg.content).trim()` on each, and joins non-empty results with `'\n\n'`.
   - Add a public exported function `renderChunksToText(jsonlContent: string): string`:
     - Call `parseJsonlContent(jsonlContent)` then `accumulateChunks(records)` (both already exist).
     - Detect whether any namespace key is non-empty (i.e. sub-agents are present: `[...nsMap.keys()].some(k => k !== '')`).
     - If **no sub-agents**: extract text from the main namespace (`nsMap.get('')`) and return it directly.
     - If **sub-agents present**: prefix the main namespace text with `'## Outer Agent\n\n'` and each sub-agent namespace with `'## Inner Agent\n\n'` (the `namespaceLabel()` helper is available for the label). Concatenate with blank-line separators.
     - Return the joined text terminated with `'\n'`. Return `'*No dialogue recorded.*\n'` when `nsMap.size === 0` or all text is empty.
   - Export `renderChunksToText` from the module's public API (alongside the existing three renderers).

### Part 2 — Backend API handler and route

2. **Add `handleGetChunkText()` to `mcp-server/gui/api.ts`**:
   - Add `writeFile` to the existing `import { rm, readFile, readdir } from 'node:fs/promises'` import.
   - Implement `handleGetChunkText(ledgerRoot, slug, filename, repoName?)`:
     - `assertSafeSlug(slug)`.
     - `if (!CHUNK_FILENAME_RE.test(filename))` → `notFound(...)`.
     - `resolveProjectStore(ledgerRoot, slug, repoName)` to get `store.storageDir`.
     - Compute `chunksDir = resolve(join(store.storageDir, CHUNKS_DIR))`.
     - Compute `mdFilename = filename.replace(/\.jsonl$/, '.md')` and `mdPath = resolve(join(chunksDir, mdFilename))`.
     - Path-prefix check on `mdPath` (defence-in-depth).
     - Try to `readFile(mdPath, 'utf-8')` — if it succeeds, return `{ content, cached: true }`.
     - If `ENOENT`: read the `.jsonl` via `readFile(resolve(join(chunksDir, filename)), 'utf-8')` (with its own `ENOENT` → `notFound` guard).
     - Call `renderChunksToText(chunkContent)`.
     - Best-effort `writeFile(mdPath, textContent, 'utf-8')` wrapped in try/catch (ignore errors).
     - Return `{ content: textContent, cached: false }`.
   - Import `renderChunksToText` from `'./chunk-renderer.js'` (`api.ts` lives in `mcp-server/gui/` — same directory as `chunk-renderer.ts`; a `../gui/` prefix would be wrong).

3. **Add route in `mcp-server/gui/server.ts`**:
   - Import `handleGetChunkText` alongside the other chunk handlers.
   - Import `renderChunksToText` is **not** needed in server.ts — the handler calls it internally.
   - Add a route block immediately after the `/rendered` route (`rest.length === 6, rest[5] === 'rendered'`):
     ```
     // GET /api/projects/:repo/:slug/chunks/:filename/text
     // rest.length === 6, rest[3] === 'chunks', rest[5] === 'text'
     ```
     Pattern: same guard conditions as the `/rendered` route (`rest[2] !== 'chunks'`, `SAFE_SLUG_REGEX` checks, `resolveRepoName`). Calls `handleGetChunkText(ledgerRoot, slug, filename, repoName)` and returns the result directly (the handler already returns `{ content, cached }`).

### Part 3 — Frontend API client

4. **Add `API.getChunkText()` to `mcp-server/gui/public/api-client.js`**:
   - Add immediately after `getChunkStructured`:
     ```javascript
     getChunkText: function (repo, slug, filename) {
       return request('GET', '/projects/' + encodeURIComponent(repo) + '/' +
         encodeURIComponent(slug) + '/chunks/' + encodeURIComponent(filename) + '/text')
         .then(function (data) { return data.content; });
     },
     ```

### Part 4 — Modal tab UI

5. **Modify `_openDialogueModal()` in `mcp-server/gui/public/views/project-detail-dialogues.js`**:
   - When `useChunks === true`: inject a `.dialogue-modal-tabs` div between the header and body in the modal HTML string. Include two `<button class="dialogue-tab">` elements — one `id="dialogue-tab-detailed"` (default active, `class="dialogue-tab active"`) and one `id="dialogue-tab-text"` (initially inactive).
   - After inserting the modal, wire up tab-switch logic via a click listener on the tab container (delegated):
     - Clicking "Detailed" tab: if not already active, show the structured content panel (already loaded); mark tab active.
     - Clicking "Text Only" tab: if not already active, check if the text content has been loaded. If not, show a loading message in the body, call `API.getChunkText(repo, slug, filename)`, render via `marked.parse(text)` in a `div.dialogue-markdown` wrapper, and cache the result in a JS variable so repeated tab switches do not re-fetch. Mark tab active.
   - When `useChunks === false` (legacy Markdown path): no tab bar is rendered — behaviour unchanged.

6. **Add CSS to `mcp-server/gui/public/styles.css`**:
   - Add a `.dialogue-modal-tabs` block after the `.dialogue-modal-header` rules (around line 2499):
     ```css
     .dialogue-modal-tabs {
       display: flex;
       gap: 0;
       border-bottom: 1px solid var(--color-border);
       padding: 0 20px;
       flex-shrink: 0;
     }
     .dialogue-tab {
       background: none;
       border: none;
       border-bottom: 2px solid transparent;
       color: var(--color-text-muted);
       cursor: pointer;
       font-size: 13px;
       font-weight: 500;
       margin-bottom: -1px;
       padding: 10px 16px;
     }
     .dialogue-tab.active {
       border-bottom-color: var(--color-link);
       color: var(--color-text);
     }
     .dialogue-tab:hover:not(.active) {
       color: var(--color-text);
     }
     ```
   - Dark-mode overrides: no custom overrides needed — the tab styles use existing CSS custom property tokens (`--color-border`, `--color-text-muted`, `--color-text`, `--color-link`) which are already remapped in dark mode.

7. **Bump version query strings in `mcp-server/gui/public/index.html`**:
   - Increment `?v=N` for `api-client.js` and `project-detail-dialogues.js` script tags to bust browser caches.

### Part 5 — CLI extraction script

8. **Create `scripts/extract-dialogue.js`** — new ESM Node.js script:
   - **Header**: shebang, doc comment, usage block.
   - **`parseArgs(argv)`**: parse `--file <path>`, `--dir <path>`, `--force`, `--dry-run`, `--help`/`-h`. Also accept a single positional argument as target (file or directory auto-detected by `fs.statSync`).
   - **`discoverChunkFiles(target)`**: if target is a `.jsonl` file, return `[target]`; if directory, return all `*.jsonl` files in that directory (non-recursive), sorted alphabetically.
   - **`parseJsonl(filePath)`**: read file, split on `\n`, skip blank and malformed lines, skip the header line (`chunk_format` key present), return array of parsed objects.
   - **`assembleText(entries)`**: single-pass through entries:
     - Group `AIMessageChunk` lines by `msg.id` (namespace-aware: track current namespace key from `entry.ns`).
     - For each AI turn, concatenate `content[].type === 'text'` fragments.
     - Accumulate text turns per namespace key (`ns.length === 0` = outer/sole agent, `ns.length > 0` = inner sub-agent). The empty namespace array (`[]`) identifies the main/outer agent in all chunk files — not length 1.
     - Returns `{ outer: string, inner: string }` where each is the concatenated prose paragraphs (turns joined by `'\n\n'`).
   - **`extractFile(chunkPath, opts)`**: orchestrate for one file:
     - Call `assembleText()` to get `{ outer, inner }`.
     - Determine if both sections are present (`inner` is non-empty).
     - Build output: if single-section, just the prose. If dual-section, prefix each with `## Outer Agent\n\n` and `## Inner Agent\n\n`.
     - Compute output path: same directory as source, `.jsonl` → `.md`.
     - If `opts.dryRun`: print the output path and skip writing.
     - If output exists and not `opts.force`: print "skip" message and return.
     - Write the `.md` file with `fs.writeFileSync`.
   - **`main()`**: parse args, discover files, call `extractFile()` for each, print summary.

### Part 6 — CLI registration and documentation

9. **Register `extract-dialogue` in `scripts/cli.js`**:
   - Add `cmdExtractDialogue(args)` function that delegates via `runScript('node', [path.join(SCRIPTS_DIR, 'extract-dialogue.js'), ...args])`.
   - Add entry to `COMMANDS` immediately after `read-log`: `{id: 'extract-dialogue', key: null, label: 'Extract chunk dialogue', category: 'Orchestrator', description: 'Extract prose text from JSONL chunk files into readable .md files', helpVariants: [['extract-dialogue <file-or-dir>', 'Extract one file or all chunks in a directory'], ['extract-dialogue <dir> --force', 'Overwrite existing .md files']], helpHidden: true, run: cmdExtractDialogue}`.

10. **Update `personas/ledger-support/src/content/ledger-orchestrator-archaeologist.md`**:
    - In **Capabilities**, replace the `(future)` placeholder sentence with concrete descriptions of both tools: the CLI script (`node scripts/extract-dialogue.js <chunk-file>`) and the GUI "Text Only" tab. State what each produces.
    - In **Workflow step 6**, add a note that the agent may call `extract-dialogue` for flagged chunk files (or open the GUI "Text Only" tab) to read assembled prose without parsing raw JSONL manually.

11. **Update `AGENTS.md` Root-Level Tooling table**:
    - Add `scripts/extract-dialogue.js` row immediately after the `scripts/read-log.js` row.

12. **Update `mcp-server/docs/agents/project-manifest/api-surface.md`**:
    - Add `renderChunksToText` under the `chunk-renderer.ts` public API section.
    - Add `handleGetChunkText` under the chunk handler section.

13. **Rebuild personas** (developer action, not code authoring):
    - Run `node scripts/build-personas.js` after the persona source update in step 10.

---

## Dependencies

- Step 2 (api.ts handler) depends on Step 1 (`renderChunksToText` must exist before the handler calls it).
- Step 3 (server.ts route) depends on Step 2 (handler must exist before the route can call it).
- Steps 1–3 (backend) and Steps 4–7 (frontend) can proceed in parallel once Step 1 is done.
- Step 8 (CLI script) is independent of all backend/frontend steps.
- Step 9 (cli.js registration) depends on Step 8 (script must exist to reference).
- Steps 10–12 (documentation) are independent of all code steps.
- Step 13 (persona rebuild) depends on Step 10.

**Build gate**: The MCP server TypeScript changes (Steps 1–3) require `npm run build` in `mcp-server/` before the GUI server can serve the new endpoint.

---

## Required Components

**Backend (TypeScript — requires build):**
- **Modified file:** `mcp-server/gui/chunk-renderer.ts` — `extractTextFromMessages()` + `renderChunksToText()`
- **Modified file:** `mcp-server/gui/api.ts` — `handleGetChunkText()` + `writeFile` import
- **Modified file:** `mcp-server/gui/server.ts` — `GET .../chunks/:filename/text` route + `handleGetChunkText` import

**Frontend (JavaScript — no build needed):**
- **Modified file:** `mcp-server/gui/public/api-client.js` — `API.getChunkText()`
- **Modified file:** `mcp-server/gui/public/views/project-detail-dialogues.js` — tab UI in `_openDialogueModal()`
- **Modified file:** `mcp-server/gui/public/styles.css` — `.dialogue-modal-tabs` + `.dialogue-tab` rules
- **Modified file:** `mcp-server/gui/public/index.html` — version bumps on changed script tags

**CLI (Node.js ESM — no build needed):**
- **New file:** `scripts/extract-dialogue.js`
- **Modified file:** `scripts/cli.js` — `cmdExtractDialogue` + COMMANDS entry

**Documentation:**
- **Modified file:** `personas/ledger-support/src/content/ledger-orchestrator-archaeologist.md`
- **Modified file:** `AGENTS.md` — Root-Level Tooling table
- **Modified file:** `mcp-server/docs/agents/project-manifest/api-surface.md`

---

## Assumptions

- Chunk files always begin with the header line `{"chunk_format": 1, …}` — skip it during parse (both CLI and server-side renderer follow this).
- `msg.id` is a stable identifier for an AI turn's streaming boundary within a namespace.
- The `.md` extension is safe to use alongside `.jsonl` — no existing `.md` files live in chunk directories.
- `marked` is available as a global in the frontend at `window.marked` — confirmed by `index.html` loading `/libs/marked.min.js`.
- The `CHUNK_FILENAME_RE` pattern in `api.ts` already covers `*.jsonl` filenames; the `.md` filename is derived server-side (not accepted from user input) so no additional regex needed.
- The GUI server has write access to the chunk directory (same server that reads it).

---

## Constraints

- **No external dependencies in CLI** — stdlib only (`fs`, `path`).
- **Cross-platform** — `path.join()`/`path.resolve()` throughout; no Unix-only utilities.
- **Read-only on source files** — neither the CLI nor the server handler ever modifies `.jsonl` files.
- **Idempotent CLI** — existing `.md` files are skipped by default; `--force` required to overwrite.
- **Best-effort write in server handler** — write errors do not propagate; content is always returned.
- **Security** — server-side `.md` filename is derived from the validated `.jsonl` filename (never from user input); path prefix check applies to the `.md` path as well.
- **ES5 frontend** — no arrow functions, `const`/`let`, template literals, or `class` syntax in JS files.
- **XSS safety** — all user-derived strings in the tab UI go through `escapeHtml()`; Markdown rendered via `marked.parse()` on content from a trusted API endpoint.

---

## Out of Scope

- Processing orchestrator run log files (`.jsonl` log files in `logs/`) — those are handled by `scripts/read-log.js`.
- Streaming chunk capture or modification — both the CLI and the server handler are purely readers of existing files.
- A dedicated "Chunks" page in the GUI — the tab is part of the existing dialogue modal only.
- Persona rebuild (Step 13) — the Developer runs `build-personas.js`; the plan step is documentation.
- CTX regeneration — deferred; the Archaeologist persona change is modest.
- Dark-mode-specific tab overrides — the tab styles use existing CSS custom property tokens that already adapt to dark mode.

---

## Acceptance Criteria

- AC-01: Running `node scripts/extract-dialogue.js <chunk-file>` produces a `.md` file in the same directory as the source `.jsonl`, with the same base name.
- AC-02: The `.md` file contains only assembled prose text from AI turns (no tool call JSON, no tool results) — one paragraph block per AI turn.
- AC-03: For chunk files with a single namespace depth (developer, qa, reviewer, docs), the output is flat prose without section headers.
- AC-04: For chunk files with dual namespace depths (pm, synthesis), the output has `## Outer Agent` and `## Inner Agent` section headers.
- AC-05: Running the script on a directory extracts all `*.jsonl` files in that directory.
- AC-06: Running with `--dry-run` prints the output paths without writing any files.
- AC-07: An existing `.md` file is not overwritten unless `--force` is passed.
- AC-08: The `extract-dialogue` command is invocable via `node scripts/cli.js extract-dialogue <args>`.
- AC-09: Opening a chunk dialogue in the GUI shows a two-tab modal: **Detailed** (current structured view, default) and **Text Only**.
- AC-10: Clicking the **Text Only** tab fetches and renders the extracted prose; a `.md` file is created alongside the `.jsonl` on first access.
- AC-11: The **Text Only** tab does not re-fetch on subsequent tab switches within the same modal session.
- AC-12: Legacy Markdown dialogues (`useChunks === false`) show no tab bar — unchanged behaviour.
- AC-13: `GET /api/projects/:repo/:slug/chunks/:filename/text` returns `{ content, cached }` — `cached: true` when a pre-existing `.md` was found; `cached: false` on first extraction.
- AC-14: The Archaeologist persona source references both the CLI script and the GUI tab, replacing the `(future)` placeholder.
- AC-15: `AGENTS.md` and `mcp-server/docs/agents/project-manifest/api-surface.md` are updated.

---

## Testing Strategy

**CLI:** Manual verification using the existing chunk files in `mcp-server/storage/ledger/starfield-load-order-manager/2026-07-21-lcs-diff-pipeline/orchestrator/chunks/`.

**Backend:** The existing Vitest suite in `mcp-server/tests/` should be extended with tests for `handleGetChunkText()` (following the `handleGetChunkFile()` test pattern in `mcp-server/tests/gui/api.test.ts`). The `renderChunksToText()` function should be tested in `mcp-server/tests/gui/chunk-renderer.test.ts` (or equivalent).

**Frontend:** Manual browser verification — open a project with chunk files, click a dialogue revision button, and verify tabs render correctly.

---

## Test Plan

**CLI tests (manual):**
- Run `node scripts/extract-dialogue.js mcp-server/storage/ledger/.../WP-001-developer-r0.jsonl` → verify `.md` exists, contains readable prose, no tool-call JSON — covers AC-01, AC-02, AC-03.
- Run same command on `project-pm-r0.jsonl` → verify `## Outer Agent` and `## Inner Agent` sections — covers AC-04.
- Run against full `chunks/` directory → verify `.md` produced for all 11 `.jsonl` files — covers AC-05.
- Run with `--dry-run` → verify no files written, paths printed — covers AC-06.
- Re-run without `--force` on directory with existing `.md` files → verify skipped — covers AC-07.
- Run `node scripts/cli.js extract-dialogue --help` → verify command recognised — covers AC-08.

**Backend tests (Vitest):**
- `renderChunksToText(singleNsJsonl)` returns prose text with no `## Outer/Inner` headers — covers AC-02, AC-03.
- `renderChunksToText(dualNsJsonl)` returns text with `## Outer Agent` and `## Inner Agent` — covers AC-04.
- `handleGetChunkText()` on a project with no `.md` file → returns `{ content, cached: false }` and writes the `.md` file — covers AC-10, AC-13.
- `handleGetChunkText()` called again → returns `{ content, cached: true }` (reads cached file) — covers AC-13.
- `handleGetChunkText()` with invalid filename → throws `NOT_FOUND` — security guard.
- `handleGetChunkText()` with path traversal attempt → throws `NOT_FOUND` — security guard.

**Browser tests (manual):**
- Open a chunk dialogue (useChunks=true) → verify two tabs appear — covers AC-09.
- Click "Text Only" tab → verify prose loads, `.md` appears in chunks directory — covers AC-10.
- Switch back to "Detailed" then back to "Text Only" → verify no second network request — covers AC-11.
- Open a legacy Markdown dialogue (useChunks=false) → verify no tabs — covers AC-12.

---

## Documentation Updates

- `AGENTS.md` — Add `scripts/extract-dialogue.js` row to Root-Level Tooling table (Step 11).
- `personas/ledger-support/src/content/ledger-orchestrator-archaeologist.md` — Update Capabilities + Workflow step 6 (Step 10).
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `renderChunksToText` and `handleGetChunkText` entries (Step 12).
- Persona rebuild (`node scripts/build-personas.js`) regenerates the deployed `.agent.md` outputs (Step 13 — developer action).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **CLI and server produce different `.md` formats** | The format contract is specified precisely in the plan (prose-only, dual-section headers). Whichever writes first, the other reads. The output files serve their purpose regardless of source. |
| **Extremely large chunk files** | Files observed up to ~11K lines. Both the CLI (single-pass, synchronous) and the server (async `readFile`) handle this comfortably in memory. |
| **Server write permission denied on `.md` file** | Handler wraps write in try/catch; content is always returned regardless. The only consequence is no caching for that request. |
| **Output `.md` files appearing in CTX generation** | Chunk files live in `mcp-server/storage/` which is not part of CTX document sources. No impact. |
| **Browser cache serving stale frontend JS** | Version query string bumps in `index.html` (Step 7) bust the cache for all modified files. |
| **Dark-mode tab styling** | Tab styles use only existing CSS custom property tokens (`--color-border`, `--color-link`, etc.) which already have dark-mode overrides. No extra CSS needed. |
| **Persona build not run after Archaeologist source update** | Plan documents the rebuild as Step 13; the persona is only used in agentic sessions, so latency is acceptable. |
| **TypeScript build not run after backend changes** | The plan's dependency block notes the build gate explicitly. The Developer must run `npm run build` in `mcp-server/` before the new endpoint is live. |

---

## Recommended Workflow

- **Workflow:** ledger
- **Rationale:** The plan now touches four distinct modules (TypeScript server, vanilla JS frontend, Node.js CLI, personas/documentation) and introduces a new API endpoint and TypeScript exports — cross-module scope warrants formal QA and code-review stages. The backend changes require a TypeScript build step and include path-traversal security guards that merit a security-audit pass.
