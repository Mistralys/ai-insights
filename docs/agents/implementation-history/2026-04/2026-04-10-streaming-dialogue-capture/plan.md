# Plan

## Summary

Replace the orchestrator's blocking `ainvoke()` call with `astream()` and capture raw stream chunks to a JSONL file (one per stage/WP) with immediate `flush()` on every line. Markdown dialogue files become a derived view — optionally rendered after stream completion for backward compatibility, and eventually rendered on-demand by the GUI. This eliminates dialogue loss on process interruption and provides a durable, re-renderable conversation archive.

## Architectural Context

The orchestrator's stage execution lives in `orchestrator/src/nodes/__init__.py`, specifically the `node_fn()` closure returned by `create_stage_node()`. The current flow is:

1. `create_deep_agent()` creates a compiled LangGraph graph.
2. `await agent.ainvoke(...)` blocks until the full message list is returned.
3. On success, `serialize_messages_to_markdown()` + `write_dialogue()` writes a one-shot Markdown file to `{slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md`.
4. On error, if `_msgs` is non-empty, a partial dialogue is written the same way.

Key related modules:
- `orchestrator/src/utils/dialogue_writer.py` — `serialize_messages_to_markdown()`, `write_dialogue()`, `_collect_usage()`, `_msg_role()`, `_render_content()`, `_render_tool_calls()`.
- `orchestrator/src/utils/logging.py` — `WorkflowLogger` with `stream_entry()` + immediate `flush()` (the pattern to replicate).
- `orchestrator/src/cli.py` — `KeyboardInterrupt` handling at three levels (graph execution, MCP startup, main).
- `orchestrator/src/config.py` — `capture_dialogues` flag (default `True`, env-controllable).
- `mcp-server/src/utils/constants.ts` — `DIALOGUES_DIR = 'orchestrator/dialogues'` (cross-language coupling point).
- `mcp-server/gui/api.ts` — `handleListDialogues()`, `handleGetDialogueFile()` read Markdown files from `DIALOGUES_DIR`.

The orchestrator pins `langgraph>=0.4` in `requirements.txt`. The v2 stream format requires `langgraph>=1.1`; the actual installed version must be verified and the pin bumped if needed.

## Approach / Architecture

The solution has two phases:

**Phase 1 — Orchestrator (durable capture):** Replace `ainvoke()` with `astream()` in `node_fn()`. Write each raw stream chunk as a JSONL line with immediate `flush()`. After stream completion, optionally render Markdown via the existing `serialize_messages_to_markdown()` path for backward compatibility.

**Phase 2 — GUI (on-demand rendering):** Add API endpoints and rendering logic to the MCP server GUI so it can list, read, and render chunk JSONL files to Markdown/HTML on demand. Once this is complete, the Phase 1 backward-compatible Markdown render becomes optional and can be disabled.

The chunk JSONL files live at `{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl`, parallel to the existing `dialogues/` directory.

## Rationale

- **Simplest hot path.** One `json.dumps()` + `"\n"` + `flush()` per chunk — no message reconstruction, no Markdown formatting, no file locking.
- **Maximum durability.** Every token-level chunk is on disk within milliseconds. A SIGKILL loses at most one in-flight token.
- **Non-destructive.** Raw chunks are the permanent source of truth. Markdown becomes a derived view that can be re-rendered when the renderer improves.
- **Fits existing pattern.** The JSONL run log already uses `stream_entry()` + `flush()`. The chunk writer mirrors this pattern.
- **Backward compatible.** Phase 1 preserves Markdown dialogue files via the existing code path. No consumer breaks during the transition.

## Detailed Steps

### Phase 1: Orchestrator — Streaming Capture

1. **Create `ChunkWriter` class** in `orchestrator/src/utils/chunk_writer.py`.
   - Constructor takes `slug_dir: Path`, `wp_id: str`, `stage: str`.
   - Creates `{slug_dir}/orchestrator/chunks/` directory.
   - Determines revision number by globbing `{wp_id}-{stage}-r*.jsonl` (same logic as `write_dialogue()`).
   - Opens `{wp_id}-{stage}-r{N}.jsonl` in append mode.
   - Writes a **header line** as the first JSONL entry: `{"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}`. This identifies the data format for future readers — if the LangGraph stream format evolves or the serialisation changes, consumers can branch on `chunk_format` to handle older files.
   - `write_chunk(chunk: dict) -> None`: `json.dumps(chunk) + "\n"` + `flush()`.
   - `close() -> None`: closes the file handle (idempotent).
   - Supports context manager protocol (`__enter__`/`__exit__`).
   - The file path is exposed as a `path` property for JSONL log events.

2. **Replace `ainvoke()` with `astream()` in `node_fn()`** in `orchestrator/src/nodes/__init__.py`.
   - Replace the single `result = await agent.ainvoke(...)` call with an `async for` loop over `agent.astream(...)`.
   - Use `stream_mode="messages"`, `subgraphs=True`, and **`version="v2"`** explicitly. The v2 stream format is a hard requirement — no v1 fallback. Each yielded item is a `StreamPart` dict with `type`, `data` (tuple of `(AIMessageChunk, metadata)`), and `ns` (namespace tuple).
   - For each stream chunk, call `chunk_writer.write_chunk(...)` with the serialised chunk data (`ns`, `msg.model_dump()`, `metadata`).
   - Accumulate `AIMessageChunk` objects in a per-message-ID dict for downstream reconstruction (see step 3).
   - Wrap the stream loop in a `try/finally` that always closes the `ChunkWriter`.

3. **Reconstruct `_msgs`, `last_msg`, `final_content`, `tokens_used`** from accumulated stream chunks.
   - During the stream loop, accumulate `AIMessageChunk` objects per message ID using the `+=` operator (`AIMessageChunk.__add__`), which merges token fragments into progressively complete messages. When a new message ID appears, the previous message is complete and can be appended to the `_msgs` list.
   - **Important distinction:** `AIMessageChunk.__add__` merges token-level *chunks* of the same message. `merge_message_runs()` is a separate utility that merges consecutive *complete* messages of the same role — it is not needed here and would not correctly reconstruct token fragments.
   - After the stream loop, extract `final_content` and `tokens_used` from the accumulated messages, matching the current extraction logic.

4. **Emit `dialogue_captured` JSONL event for chunk files.**
   - When `capture_dialogues` is enabled, emit a `dialogue_captured` event with `"format": "chunks"` and the chunk file path at stream start (file creation time).
   - This is in addition to the existing `dialogue_captured` event for the Markdown file (if backward-compatible Markdown render is enabled).

5. **Preserve backward-compatible Markdown render.**
   - After the stream completes (in the success path), optionally call `serialize_messages_to_markdown()` + `write_dialogue()` using the merged message list, preserving the current Markdown file output.
   - This is gated behind `capture_dialogues` as before.
   - In the error path, the partial chunk JSONL is already on disk; optionally also write a partial Markdown file from `_msgs` as the current code does.

6. **Bump `langgraph` version pin** in `orchestrator/requirements.txt`.
   - The v2 stream format (`version="v2"`) is a hard requirement. Bump the pin to `langgraph>=1.1,<2.0`.
   - Verify the installed version after bumping. If the current environment has an older version, run `pip install --upgrade langgraph` in the venv.
   - No v1 fallback. The chunk serialisation logic, `ChunkWriter` header, and GUI renderer all assume v2 format exclusively.

7. **Add signal handling for graceful shutdown** in `orchestrator/src/cli.py` (defence-in-depth).
   - Register `SIGTERM` and `SIGINT` handlers using `asyncio`'s `loop.add_signal_handler()` to set a shutdown event.
   - The chunk writer's `flush()` ensures data is on disk regardless, but signal handling allows a cleaner shutdown path (closing file handles, emitting a final log entry).
   - Note: `add_signal_handler()` is Unix-only. On Windows, fall back to `signal.signal()` or skip (the `flush()` per chunk already provides durability).

### Phase 2: GUI — On-Demand Rendering

8. **Add `CHUNKS_DIR` constant** to `mcp-server/src/utils/constants.ts`.
   - `export const CHUNKS_DIR = 'orchestrator/chunks' as const;`
   - Parallel to the existing `DIALOGUES_DIR`.

9. **Add `handleListChunks()` API handler** to `mcp-server/gui/api.ts`.
   - Lists `.jsonl` files in `{slug_dir}/orchestrator/chunks/`.
   - Parses filenames using the same `{wp_id}-{stage}-r{N}` convention.
   - Supports optional `wpId` filter.
   - Returns structured entries with `filename`, `wp_id`, `stage`.

10. **Add `handleGetChunkFile()` API handler** to `mcp-server/gui/api.ts`.
    - Returns raw JSONL content for a specific chunk file.
    - Same security guards as `handleGetDialogueFile()` (slug validation, filename allowlist, path traversal defence).

11. **Add chunk-to-Markdown renderer** to the GUI layer.
    - New module (e.g. `mcp-server/gui/chunk-renderer.ts`) with a `renderChunksToMarkdown(jsonlContent: string): string` function.
    - Reads JSONL line by line.
    - Groups chunks by namespace (main agent vs. subagent).
    - Merges token-level `AIMessageChunk` data into complete messages.
    - Renders to Markdown using a format consistent with the orchestrator's `serialize_messages_to_markdown()`.
    - Pure data transformation — no I/O, no state, easily testable.

12. **Add API endpoint for rendered chunk view** to `mcp-server/gui/server.ts`.
    - `GET /api/projects/:slug/chunks/:filename/rendered` — returns rendered Markdown from the chunk JSONL file.
    - Calls `handleGetChunkFile()` → `renderChunksToMarkdown()`.

13. **Wire routes** in `mcp-server/gui/server.ts`.
    - Add route handlers for the new chunk endpoints parallel to the existing dialogue routes.

14. **Update GUI frontend** to display chunk-based dialogue views.
    - The frontend should prefer chunk JSONL files when available, falling back to Markdown dialogue files for older runs.

## Dependencies

- `langgraph>=1.1,<2.0` — hard requirement for v2 stream format with `stream_mode="messages"`, `subgraphs=True`, and `version="v2"`. Current pin is `>=0.4`; must be bumped.
- `langchain_core` — already a dependency; provides `AIMessageChunk` and its `__add__` operator for chunk accumulation.
- `deepagents>=0.5.1` — already installed; its `create_deep_agent()` returns a compiled LangGraph graph supporting `astream()`.

## Required Components

### New files
- `orchestrator/src/utils/chunk_writer.py` — `ChunkWriter` class (step 1).
- `mcp-server/gui/chunk-renderer.ts` — Chunk-to-Markdown renderer (step 11).

### Modified files
- `orchestrator/src/nodes/__init__.py` — Replace `ainvoke()` with `astream()` loop, integrate `ChunkWriter` (steps 2–5).
- `orchestrator/src/cli.py` — Add signal handlers (step 7).
- `orchestrator/requirements.txt` — Bump `langgraph` pin if needed (step 6).
- `mcp-server/src/utils/constants.ts` — Add `CHUNKS_DIR` constant (step 8).
- `mcp-server/gui/api.ts` — Add `handleListChunks()`, `handleGetChunkFile()` (steps 9–10).
- `mcp-server/gui/server.ts` — Wire new routes (step 13).

### Manifest documents to update
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Document `ChunkWriter` class.
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add `chunk_writer.py`.
- `orchestrator/docs/agents/project-manifest/data-flows.md` — Update dialogue capture flow.
- `orchestrator/docs/agents/project-manifest/tech-stack.md` — Update `langgraph` version pin if changed.
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Document new GUI API endpoints and `CHUNKS_DIR` constant.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Add `chunk-renderer.ts`.

## Assumptions

- `astream()` with `stream_mode="messages"` and `subgraphs=True` works on compiled Deep Agent graphs (needs empirical verification per Open Questions in the research paper).
- `AIMessageChunk.model_dump()` round-trips cleanly through JSON serialisation for all message types (AI, Human, Tool, System) and content block variants.
- The `flush()` call on each chunk write pushes data to the OS kernel buffer, which survives process termination (true for standard Python file I/O on all three platforms).
- The GUI frontend is a web-based SPA that can accept new API endpoints without structural changes.
- No external consumers depend on the Markdown dialogue files being present synchronously during stage execution (they only consume them after stage completion).

## Constraints

- Cross-platform: `ChunkWriter` must use `pathlib.Path` for all path operations. No OS-specific APIs.
- Cross-language coupling: the `CHUNKS_DIR` path (`orchestrator/chunks`) must be identical in the Python writer and the TypeScript constant.
- The `capture_dialogues` config flag must gate both chunk writing and backward-compatible Markdown rendering.
- The `ChunkWriter` must be non-fatal: any file I/O error during chunk writing should be logged at DEBUG and swallowed, matching the existing dialogue capture error handling.
- Signal handler registration must be platform-guarded: `loop.add_signal_handler()` is Unix-only. On Windows, either use `signal.signal()` or skip signal handling (chunk `flush()` already provides durability).

## Out of Scope

- **Live UI streaming / tailing.** The chunk JSONL format enables future live-streaming support, but implementing a real-time tail view is not part of this plan.
- **Removing backward-compatible Markdown rendering.** Phase 1 preserves Markdown files. Removal is a future task once the GUI reads JSONL natively.
- **LangGraph checkpointer-based recovery.** The checkpointer remains as-is; it's complementary but not changed by this work.
- **Chunk file size management / rotation.** Storage budgets and cleanup are deferred.
- **`os.fsync()` on every chunk write.** The research paper notes this as a maximum-safety option at ~1ms/chunk cost. Not included unless profiling reveals data loss scenarios that `flush()` alone doesn't cover.

## Acceptance Criteria

- After a stage completes normally, a `{wp_id}-{stage}-r{N}.jsonl` file exists in `{slug_dir}/orchestrator/chunks/` containing one JSON line per stream chunk.
- The first JSONL line is a header: `{"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}`.
- Each subsequent JSONL line contains `ns` (namespace), `msg` (serialised message chunk), and `metadata`.
- A SIGTERM during stage execution preserves all chunks written before the signal in the JSONL file.
- The existing Markdown dialogue files are still produced (backward compatibility) when `capture_dialogues=True`.
- The `dialogue_captured` JSONL event is emitted for chunk files with `"format": "chunks"`.
- `final_content`, `tokens_used`, and all downstream state-update fields remain identical to the pre-change behavior.
- No existing tests break.
- (Phase 2) The GUI can list and render chunk JSONL files to Markdown/HTML on demand via new API endpoints.

## Testing Strategy

### Phase 1 (Orchestrator)
- **Unit tests for `ChunkWriter`:** Verify file creation, revision numbering, JSONL format, `flush()` behavior, idempotent `close()`, context manager protocol, and that the first line is a valid header with `chunk_format`, `stream_mode`, and `langgraph_stream_version` fields. Use `tempfile.mkdtemp()` for platform-agnostic temp directories.
- **Unit test for chunk serialisation round-trip:** Verify that `AIMessageChunk.model_dump()` → `json.dumps()` → `json.loads()` produces dicts that can reconstruct the original message (via `AIMessageChunk.__add__` accumulation) for all types (AI, Human, Tool, System) and content block variants.
- **Unit test for partial JSONL recovery:** Write N chunks, truncate the file mid-line, verify that lines 1 through N-1 are recoverable.
- **Integration test for `node_fn()` with `astream()`:** Mock `create_deep_agent()` to return a graph that yields known chunks. Verify that the chunk JSONL file is written correctly and that `_msgs`, `final_content`, `tokens_used` are extracted correctly.
- **Test backward-compatible Markdown render:** Verify that the Markdown file produced from merged stream chunks matches the format of the pre-change `serialize_messages_to_markdown()` output.
- **Signal handling test (manual):** Run the orchestrator against a real plan, send SIGTERM mid-stage, verify the chunk JSONL file contains all chunks up to the signal.

### Phase 2 (GUI)
- **Unit tests for `renderChunksToMarkdown()`:** Feed known JSONL content, verify Markdown output matches expected format. Test empty input, single message, multi-turn conversation, subagent messages.
- **API tests for `handleListChunks()` and `handleGetChunkFile()`:** Verify listing, filtering, security guards, and file content retrieval.
- **Test path traversal defence:** Verify that malicious filenames are rejected by the chunk file endpoint.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`astream()` behaves differently on Deep Agent graphs than documented.** | Step 2 should start with a minimal proof-of-concept that streams a single stage and logs the chunk structure before refactoring `node_fn()`. Validate chunk structure empirically. |
| **`AIMessageChunk.model_dump()` loses data for some content block types (tool_use, image, partial JSON).** | Write round-trip tests (Step 6 of PoC) before integrating into `node_fn()`. If fidelity issues are found, fall back to `updates` stream mode (complete messages, no merging needed). |
| **`langgraph>=1.1` version bump introduces breaking changes.** | Pin to `langgraph>=1.1,<2.0`. Run existing tests after the bump. Review the LangGraph changelog for breaking changes between the currently installed version and 1.1. |
| **Chunk JSONL files grow very large for tool-heavy stages.** | Monitor file sizes during initial deployment. If problematic, consider switching to `updates` mode (coarser granularity, smaller files) or adding per-stage size caps. |
| **`add_signal_handler()` fails on Windows.** | Guard with platform check (`sys.platform != "win32"`). On Windows, `flush()` per chunk already provides durability; signal handling is defence-in-depth, not critical. |
| **GUI chunk renderer takes significant effort, delaying the full benefit.** | Phase 1's backward-compatible Markdown render ensures no regression. The GUI work (Phase 2) can be scheduled independently. |
