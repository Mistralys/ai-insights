# Orchestrator — Data Flows

> **Parent:** [project-manifest/README.md](README.md)

Describes the key interaction paths through the orchestrator.

---

## Flow 1: Dialogue Capture (Legacy Markdown — module only)

> **Note:** As of the streaming-dialogue-capture rework, `node_fn()` no longer
> calls `serialize_messages_to_markdown()` or `write_dialogue()`. The chunk JSONL
> file (Flow 2) is the sole capture artefact for new runs. The `dialogue_writer`
> module is retained for manual invocation but is not called during normal pipeline
> execution.

**Entry Point:** Direct call to `dialogue_writer.write_dialogue()` (manual / scripted use only)

```
dialogue_writer.write_dialogue(content, slug_dir, wp_id, stage)
  ↓
next_revision(dialogues_dir, wp_id, stage, ".md")  ← shared _revision.py helper
  ↓
Write {wp_id}-{stage}-r{N}.md
  → {slug_dir}/orchestrator/dialogues/{wp_id}-{stage}-r{N}.md
```

**Result:** A human-readable Markdown file per stage run, stored in the project's `orchestrator/dialogues/` directory. Revision `N` auto-increments; the latest revision is the highest `r` suffix. Pre-existing files from older runs are still served by the GUI.

---

## Flow 2: Streaming Chunk Capture (JSONL)

**Entry Point:** Stage node opens a `ChunkWriter` before iterating the LangGraph stream

```
Stage node
  ↓
ChunkWriter(slug_dir, wp_id, stage).__enter__()
  ↓
  Creates {slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl
  Writes header line: {"chunk_format": 1, "stream_mode": "messages", "langgraph_stream_version": "v2"}
  ↓
for chunk in graph.astream(…, stream_mode="messages"):
    cw.write_chunk(chunk)          ← appends one JSON line per token/event, immediate flush
  ↓
ChunkWriter.__exit__()  →  cw.close()
  ↓
{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl complete
```

**Result:** A JSONL file capturing the raw LangGraph `AIMessageChunk` stream. One file per stage run; revision numbering uses the shared `next_revision()` helper from `_revision.py`. Both `OSError` and `TypeError` during write are caught and swallowed (logged at DEBUG) — the stage run is never interrupted.

---

## Flow 3: Chunk Rendering (JSONL → Markdown)

**Entry Point:** GUI requests rendered Markdown for a chunk file

```
Browser → GET /api/projects/:slug/chunks/:filename/rendered
  ↓
gui/server.ts router
  ↓
handleGetChunkFile(ledgerRoot, slug, filename)   ← reads raw JSONL from disk
  ↓
renderChunksToMarkdown(jsonlContent)             ← gui/chunk-renderer.ts
  ↓
  1. Parse header line (validates chunk_format: 1)
  2. Parse each chunk line — normalises object shape and array (tuple) shape
  3. Accumulate AIMessageChunk objects by id (merge content, tool_calls, usage_metadata)
  4. Group merged messages by namespace (main agent vs. sub-agents)
  5. Render Markdown — document heading + metadata table, per-message sections,
     tool-call blocks, token-usage footer
  ↓
Return { content: "<rendered Markdown string>" }
  ↓
Browser renders Markdown via marked.parse()
```

**Result:** Human-readable Markdown consistent with `serialize_messages_to_markdown()` output, generated on-the-fly from the raw JSONL chunk file. No disk write — pure in-memory transformation.

---

## Flow 4: Chunk File Discovery

**Entry Point:** GUI requests list of chunk files for a project (or filtered by WP)

```
Browser → GET /api/projects/:slug/chunks[?wp=WP-001]
  ↓
handleListChunks(ledgerRoot, slug, wpId?)
  ↓
readdir({ledgerRoot}/{slug}/orchestrator/chunks/)
  ↓
Filter to *.jsonl filenames
Optional: prefix-filter by "{wpId}-" (wpId validated against WP_ID_RE before use)
  ↓
Sort alphabetically → map parseChunkFilename()
  → { filename, wp_id, stage } per entry
  ↓
Return ChunkEntry[]   ([] when directory is absent — no error)
```

**Result:** Sorted array of `ChunkEntry` objects. The GUI uses this list to populate the Dialogues card in the work-package detail view — chunk files take priority over Markdown dialogue files when both exist.

---

## Relationship: Chunks vs. Dialogues

| Aspect | Chunks (`orchestrator/chunks/`) | Dialogues (`orchestrator/dialogues/`) |
|--------|--------------------------------|--------------------------------------|
| Format | JSONL (token-level stream) | Markdown (rendered prose) |
| Producer | `ChunkWriter` (Python) | `dialogue_writer.write_dialogue` (Python) — manual use only; no longer called by `node_fn()` |
| Consumer | `chunk-renderer.ts` (TypeScript) | Served directly as-is |
| GUI priority | **Higher** (chunks override dialogues) | Fallback when no chunks (pre-streaming runs) |
| Rendering | On-the-fly by GUI server | Pre-rendered at capture time |
