# Plan: Agent Dialogue Capture

## Summary

Capture the full LLM conversation (system prompt, user prompt, all assistant responses, tool calls, and tool results) for each pipeline stage execution in the orchestrator, persist them as Markdown files in the project's ledger storage, and make them browsable in the GUI dashboard. The feature is opt-in via a `capture_dialogues` toggle in both the orchestrator `.env` and the GUI settings view.

## Architectural Context

The orchestrator's stage nodes are produced by a single generic factory `create_stage_node()` in `orchestrator/src/nodes/__init__.py`. Each stage invocation follows this lifecycle:

1. **`stage_start`** event emitted (with `iteration` count) via `run_logger.stream_entry()`
2. Persona loaded, Deep Agent created, `agent.ainvoke()` called — returns a `{"messages": [...]}` dict containing the **complete conversation history** (every `HumanMessage`, `AIMessage`, and `ToolMessage` in order)
3. Only the last message's `.content` is extracted as `final_content`; usage metadata (`usage_metadata`) is read from the last `AIMessage` only (not per-message). Everything else is discarded (line ~100–106).
4. **`stage_complete`** event emitted (with `duration_s`, `tokens_used`)
5. **`pipeline_result`** read-back — best-effort fetch of the WP's latest pipeline via `ledger_get_work_package`, emitting pipeline type/status/metrics/files_modified (lines ~128–164)

All events use the established `run_logger.stream_entry(entry)` pattern (where `run_logger` is obtained via `get_run_logger(config)` from `orchestrator/src/utils/logging.py`). Console output for each event type is formatted by `_build_stream_console_line()` in the same module — each known `action` value has a dedicated formatting branch. The `run_log` field in `WorkflowState` uses an `operator.add` reducer, so each node only returns *new* entries and LangGraph merges them.

The `Config` dataclass already has a `workspace_root` field that resolves to the ai-insights workspace root. The ledger root can be derived as `Path(config.workspace_root) / "mcp-server" / "storage" / "ledger"` without a new env var.

The MCP server's ledger stores per-project data in flat directories under `mcp-server/storage/ledger/{slug}/`. Two Markdown documents are already archived into this directory: `plan.md` (at project init) and `synthesis.md` (at project completion). The GUI serves these via `GET /api/projects/:slug/plan` and `GET /api/projects/:slug/synthesis`, rendering them with `marked.js`.

The GUI settings view (`mcp-server/gui/public/views/config.js`) currently exposes three toggles: auto-handoff enabled, max handoff depth, and auto-archive days. The config schema lives in `mcp-server/src/gui/config.ts` (`GuiConfigSchema`) and is persisted to `{ledgerRoot}/gui-config.json`.

Key files:
- `orchestrator/src/nodes/__init__.py` — stage node factory (stage lifecycle, pipeline read-back)
- `orchestrator/src/utils/logging.py` — `WorkflowLogger` class + `_build_stream_console_line()` event formatter
- `orchestrator/src/utils/mcp_parse.py` — `parse_tool_response()` shared MCP response parser
- `orchestrator/src/utils/tool_wrappers.py` — `inject_project_path()` tool wrapping utility
- `orchestrator/src/config.py` — `Config` dataclass + `load_config()` (has `workspace_root`)
- `orchestrator/src/state.py` — `WorkflowState` TypedDict (`run_log` uses `operator.add` reducer)
- `orchestrator/docs/jsonl-log-schema.md` — full field reference for all 16 JSONL event types
- `mcp-server/src/gui/config.ts` — `GuiConfigSchema`, `getConfig()`, `writeConfig()`
- `mcp-server/gui/api.ts` — API handlers (plan/synthesis document pattern)
- `mcp-server/gui/server.ts` — HTTP route matching
- `mcp-server/gui/public/views/config.js` — settings form
- `mcp-server/gui/public/views/work-package.js` — WP detail view
- `mcp-server/gui/public/api-client.js` — frontend HTTP client
- `mcp-server/gui/public/router.js` — SPA hash-based routing

## Approach / Architecture

### Storage: Dialogue files in the ledger

Each dialogue is persisted as a Markdown file inside a `dialogues/` subdirectory within the project's ledger folder:

```
mcp-server/storage/ledger/{slug}/
  dialogues/
    WP-001-developer-r0.md
    WP-001-developer-r1.md      ← rework produced a second revision
    WP-001-qa-r0.md
    WP-001-reviewer-r0.md
    WP-002-developer-r0.md
    ...
```

**Naming convention:** `{wpId}-{stage}-r{revision}.md` (e.g. `WP-003-developer-r0.md`, `WP-003-developer-r1.md`). The revision number starts at `r0` for the first execution and increments on each rework, preserving the full dialogue history across iterations. The writer determines the next revision by scanning existing files matching the `{wpId}-{stage}-r*.md` glob pattern.

**Why Markdown in the ledger (not JSONL)?** The primary consumer is a human reading through agent reasoning. Markdown renders naturally in the GUI (reusing the existing `marked.js` pipeline) and is readable in any text editor. The existing plan/synthesis archive pattern proves this approach.

### Data flow

1. **Orchestrator** captures dialogues and writes them to the ledger's `dialogues/` directory directly (the orchestrator already knows the `project_path` → slug mapping, and the ledger root is on the same filesystem).
2. **GUI server** serves dialogue files via a new API endpoint: `GET /api/projects/:slug/dialogues/:filename`.
3. **GUI frontend** adds a "Dialogues" section to the WP detail view, listing available dialogue files for that WP and rendering them as Markdown when clicked.

### Config flow

The `capture_dialogues` setting lives in two places:
- **Orchestrator side:** `CAPTURE_DIALOGUES=true` in `.env` → read by `load_config()` → stored in `Config.capture_dialogues`.
- **GUI side:** `capture_dialogues: boolean` in `GuiConfigSchema` → toggled in the settings view → persisted in `gui-config.json`.

The orchestrator reads its own `.env` at startup. The GUI toggle controls the same behavior for future orchestrator runs by also writing to the orchestrator's `.env` — **however**, modifying another module's `.env` from the GUI introduces coupling. A simpler approach: the orchestrator reads its own flag from `.env`, and the GUI toggle is informational/convenient. The user toggles it in the GUI, and the next orchestrator launch picks it up from `.env`. Alternatively, the orchestrator can also check the GUI config file at startup as a secondary source.

**Chosen approach:** The orchestrator reads `CAPTURE_DIALOGUES` from its own `.env`. The GUI toggle updates a `capture_dialogues` field in `gui-config.json` (following the existing pattern). A note in the GUI reminds the user that changes take effect on the next orchestrator run. This keeps modules decoupled.

## Rationale

- **Markdown over JSONL:** Optimized for human reading (the stated goal — studying what the model struggled with). JSONL logs already cover machine-readable event data. Messages in conversations can contain tool call JSON, code blocks, and multi-paragraph reasoning — Markdown handles all of these naturally.
- **Ledger storage over orchestrator logs:** Keeps dialogues co-located with the project they belong to, making them accessible through the existing GUI infrastructure and browsable per-WP.
- **Versioned on rework:** Preserves the full dialogue history across rework iterations. Comparing what the agent did in `r0` vs `r1` reveals how the rework feedback changed its approach — invaluable for persona refinement.
- **Per-WP-per-stage files:** Matches the mental model of "what did the developer agent think when working on WP-003?" and integrates naturally with the WP detail view.
- **WP detail only (no top-level view):** Dialogues are meaningful in their WP context — the associated acceptance criteria, pipeline status, and handoff notes frame the conversation. A top-level view without this context would lose the narrative.
- **Opt-in:** Dialogues can be large (10–50KB each, potentially hundreds of KB per run). Users who don't need them shouldn't pay the I/O and storage cost.

## Detailed Steps

### 1. Add `capture_dialogues` to orchestrator Config

- Add field to `Config` dataclass in `orchestrator/src/config.py`
- Read `CAPTURE_DIALOGUES` env var (default: `false`) in `load_config()`

### 2. Add dialogue serialization utility

- Create `orchestrator/src/utils/dialogue_writer.py`
- Implement `serialize_messages_to_markdown(messages, stage, wp_id, timestamp) -> str`
  - Iterate the `messages` list from `agent.ainvoke()` result
  - For each message, emit a Markdown section with role and content
  - Handle `HumanMessage`, `AIMessage`, `ToolMessage` types
  - For `AIMessage` with tool calls, render the tool call name and arguments
  - For `ToolMessage`, render the tool response content
  - **Note:** Per-message token counts are not available. Only the final `AIMessage` carries aggregate `usage_metadata` (via `getattr(msg, "usage_metadata", None)`). Include this aggregate in the file header or footer, not per-message.
- Implement `write_dialogue(content, ledger_slug_dir, wp_id, stage) -> Path`
  - Create `dialogues/` subdirectory if needed
  - Scan existing files matching `{wpId}-{stage}-r*.md` to determine the next revision number
  - Write `{wpId}-{stage}-r{revision}.md` file
  - Return the path for logging

### 3. Integrate into `create_stage_node()`

- In `orchestrator/src/nodes/__init__.py`, insert the capture block **after** the `_msgs` / `final_content` / `tokens_used` extraction (line ~106) but **before** the `pipeline_result` read-back block (line ~128):
  - Check `_app_config.capture_dialogues` (not `config`, which is LangGraph's `RunnableConfig`)
  - If true, call the dialogue writer with the full `_msgs` list
  - Derive the ledger slug directory from `_app_config.workspace_root`: `Path(_app_config.workspace_root) / "mcp-server" / "storage" / "ledger"` + slug derived from `state["project_path"]`
  - Emit a `dialogue_captured` event via the existing `run_logger.stream_entry()` pattern (include fields: `stage`, `wp_id`, `filename`, `revision`, `level="INFO"`)
  - Append the event entry to `extra_log_entries` so it is included in the returned `run_log` list (following the `operator.add` reducer convention)
- Add a `dialogue_captured` formatting branch to `_build_stream_console_line()` in `orchestrator/src/utils/logging.py`, e.g.:
  ```python
  if action == "dialogue_captured":
      parts = [prefix]
      if wp_id:
          parts.append(wp_id)
      parts.append(f"dialogue saved → {entry.get('filename', '')}")
      return " ".join(parts)
  ```
- Add the `dialogue_captured` event type to `orchestrator/docs/jsonl-log-schema.md` — add a row to the Action Values table and document the `filename`, `revision`, and `path` fields in the Full Field Reference table

### 4. Add `capture_dialogues` to GUI config schema

- In `mcp-server/src/gui/config.ts`, add `capture_dialogues: z.boolean().default(false)` to `GuiConfigSchema`

### 5. Add dialogue toggle to GUI settings view

- In `mcp-server/gui/public/views/config.js`, add a checkbox following the auto-handoff pattern
- Include a note: "Captures full LLM conversations during orchestrator runs. Takes effect on next run."
- Wire it into the form submit handler (same pattern as `auto_handoff_enabled`)

### 6. Add API endpoint to serve dialogue files

- In `mcp-server/gui/api.ts`, add `handleGetDialogueFile(ledgerRoot, slug, filename)` handler
  - Validate slug with `assertSafeSlug()`
  - Validate filename against a safe pattern (alphanumeric, hyphens, underscores, `.md` extension only — no path traversal)
  - Read and return the file content from `{ledgerRoot}/{slug}/dialogues/{filename}`
- In `mcp-server/gui/api.ts`, add `handleListDialogues(ledgerRoot, slug, wpId?)` handler
  - List all `.md` files in `{ledgerRoot}/{slug}/dialogues/`
  - Optionally filter by WP ID prefix
  - Return array of `{ filename, stage, wp_id }`

### 7. Add API routes in server.ts

- `GET /api/projects/:slug/dialogues` → `handleListDialogues`
- `GET /api/projects/:slug/dialogues/:filename` → `handleGetDialogueFile`
- Follow the existing matching pattern used for plan/synthesis routes

### 8. Add frontend API client methods

- In `mcp-server/gui/public/api-client.js`, add:
  - `getDialogues(slug, wpId)` → `GET /api/projects/:slug/dialogues?wp=:wpId`
  - `getDialogueContent(slug, filename)` → `GET /api/projects/:slug/dialogues/:filename`

### 9. Add Dialogues section to WP detail view

- In `mcp-server/gui/public/views/work-package.js`, add a "Dialogues" card after the existing pipeline cards
- The card lists available dialogue files for this WP (fetched via `getDialogues`)
- Group entries by stage name; within each stage, show revision badges (r0, r1, r2, …)
- Each revision is a clickable link that expands inline or navigates to show the rendered Markdown content (using `marked.parse()`, same as plan/synthesis views)
- When multiple revisions exist, visually indicate the latest (e.g. bold or highlight) so the user can quickly find the most recent
- If no dialogues exist for this WP, hide the card entirely

### 10. Derive ledger root from existing `workspace_root`

- The orchestrator needs to know where to write dialogue files. The `Config` dataclass already has a `workspace_root` field (the ai-insights workspace root).
- Derive the ledger root as `Path(config.workspace_root) / "mcp-server" / "storage" / "ledger"` — no new env var or config field is needed.
- The dialogue writer accepts the derived ledger root as a parameter and uses it to resolve the slug directory.

### 11. Tests

- **Orchestrator:**
  - Unit test for `serialize_messages_to_markdown()` — verify correct Markdown structure for various message types
  - Unit test for `write_dialogue()` — verify file creation in correct path, revision auto-increment logic
  - Unit test for `create_stage_node()` — verify dialogue capture is called when `capture_dialogues=True` and skipped when `False`
- **MCP server:**
  - Unit test for `handleListDialogues` — verify listing and WP filtering
  - Unit test for `handleGetDialogueFile` — verify content serving and path traversal rejection
  - Integration test for the config toggle (schema validation)

## Dependencies

- The orchestrator must know the ledger root path to write files directly into the ledger storage directory
- The dialogue filename convention must be agreed upon between the orchestrator (writer) and the GUI (reader)

## Required Components

### New files
- `orchestrator/src/utils/dialogue_writer.py` — serialization + file writing
- `orchestrator/tests/test_dialogue_writer.py` — unit tests for the writer

### Modified files
- `orchestrator/src/config.py` — add `capture_dialogues` field
- `orchestrator/src/nodes/__init__.py` — call dialogue writer after `ainvoke()`, emit `dialogue_captured` event
- `orchestrator/src/utils/logging.py` — add `dialogue_captured` console formatter branch
- `orchestrator/docs/jsonl-log-schema.md` — add `dialogue_captured` event type to schema
- `mcp-server/src/gui/config.ts` — add `capture_dialogues` to schema
- `mcp-server/gui/api.ts` — add dialogue list/read handlers
- `mcp-server/gui/server.ts` — add dialogue routes
- `mcp-server/gui/public/api-client.js` — add dialogue API methods
- `mcp-server/gui/public/views/config.js` — add capture toggle
- `mcp-server/gui/public/views/work-package.js` — add dialogues card
- `mcp-server/src/utils/constants.ts` — add `DIALOGUES_DIR` constant

## Assumptions

- LangChain message objects returned by `agent.ainvoke()` expose `.content`, `.role` (or message type discrimination), and tool call data through standard LangChain APIs (`AIMessage`, `HumanMessage`, `ToolMessage`). Aggregate `.usage_metadata` is only available on the final `AIMessage`, not per-message.
- The orchestrator process has filesystem write access to the MCP server's ledger storage directory (both are on the same local machine).
- Dialogue files in the 10–100KB range per stage execution are acceptable storage costs.

## Constraints

- **No new dependencies** — use only the Python and Node.js standard libraries plus existing project dependencies.
- **STDIO discipline** — the orchestrator must not write to stdout (reserved for MCP protocol). All dialogue I/O goes to the filesystem.
- **Path traversal safety** — the GUI API must validate dialogue filenames strictly to prevent directory traversal attacks.
- **Atomic writes are not required** for dialogue files — they are write-once artifacts, not concurrent-access data. Simple `writeFile` is sufficient.

## Out of Scope

- Real-time streaming of dialogues to the GUI during a run (this is a post-run review feature)
- Dialogue diffing UI between rework revisions (files are preserved, but no visual diff tool is included)
- Token cost aggregation or analytics dashboards derived from dialogue content
- LangSmith integration (separate concern, already available via env vars)
- Dialogue capture for the supervisor (it makes no LLM calls — routing is algorithmic)

## Acceptance Criteria

- When `CAPTURE_DIALOGUES=true`, every stage execution writes a Markdown file to `{ledgerRoot}/{slug}/dialogues/{wpId}-{stage}-r{N}.md`
- Revision numbers auto-increment: first execution produces `r0`, first rework produces `r1`, etc.
- When `CAPTURE_DIALOGUES` is unset or `false`, no dialogue files are written
- Dialogue Markdown files contain: header with stage/WP/timestamp/aggregate token counts, the full user prompt, all assistant responses, all tool calls with arguments, all tool results
- The GUI settings view shows a "Capture dialogues" toggle that persists to `gui-config.json`
- The WP detail view shows a "Dialogues" card listing all available dialogue files for that WP
- Clicking a dialogue entry renders the Markdown content in the GUI
- The API rejects filenames with path traversal characters (`..`, `/`, `\`)
- Feature works end-to-end: run orchestrator with flag → dialogues appear in GUI

## Testing Strategy

- **Unit tests** for the Markdown serializer: verify output structure for conversations with tool calls, multi-turn exchanges, and edge cases (empty messages, missing usage metadata)
- **Unit tests** for the file writer: verify correct path construction and directory creation
- **Unit tests** for the API handlers: verify listing, filtering, content serving, and security (path traversal rejection)
- **Integration test** (manual or automated): run orchestrator with `CAPTURE_DIALOGUES=true` on a small plan, verify dialogue files appear in storage and are visible in the GUI

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Large dialogue files slow down the GUI** | Render Markdown client-side with `marked.js` (already proven with plan/synthesis). Consider adding a file size indicator in the list view so users know what to expect. |
| **Message type discrimination breaks with LangChain updates** | Use defensive `getattr()` / `hasattr()` checks and fall back to string representation for unknown message types. |
| **Orchestrator cannot write to ledger directory (permissions or path mismatch)** | Validate the derived ledger root (`workspace_root / mcp-server/storage/ledger/`) at first write attempt. Log a warning and disable capture for the remainder of the run if the directory is not writable. |
| **Dialogue files accumulate unbounded storage** | Files live inside the project ledger directory and are subject to the same lifecycle (archiving, deletion) as the rest of the project data. |
- **Dialogue versions accumulate per rework** | Bounded by the number of rework iterations per WP (typically 1–3). If storage becomes a concern, old revisions can be pruned manually or via a future cleanup command. |
