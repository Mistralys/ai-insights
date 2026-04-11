# Project Synthesis Report
**Project:** 2026-04-10-streaming-dialogue-capture  
**Synthesized:** 2026-04-10  
**Status:** COMPLETE (6 WPs COMPLETE, 1 CANCELLED, 0 FAILED)

---

## Executive Summary

This session delivered a full **streaming dialogue capture** system for the AI Insights orchestrator, replacing the previous blocking `ainvoke()` call with a live streaming `astream()` pipeline that writes every token-level chunk to disk immediately — eliminating dialogue loss on process interruption.

The work spanned two phases and touched both the Python orchestrator and the TypeScript MCP server GUI:

**Phase 1 — Orchestrator (durable capture)**
- A new `ChunkWriter` class provides a stateful, context-manager–safe JSONL writer that flushes every chunk synchronously to `{slug_dir}/orchestrator/chunks/{wp_id}-{stage}-r{N}.jsonl`.
- `node_fn()` in `nodes/__init__.py` was refactored from `ainvoke()` to `astream(stream_mode="messages", subgraphs=True)`, accumulating `AIMessageChunk` fragments per message ID via `+=` and reconstructing `_msgs`, `final_content`, and `tokens_used` in the `finally` block.
- A graceful SIGTERM/SIGINT shutdown path was added to `cli.py` via `asyncio.loop.add_signal_handler()` (Unix) with a Windows fallback, ensuring signal-interrupted runs are not marked terminal and remain resumable via `--resume`.
- The `langgraph` dependency pin was bumped from `>=0.4` to `>=1.1,<2.0` to enforce the v2 stream format.

**Phase 2 — GUI (on-demand rendering)**
- `CHUNKS_DIR = 'orchestrator/chunks'` constant added to `mcp-server/src/utils/constants.ts`.
- `handleListChunks()` and `handleGetChunkFile()` handlers added to `gui/api.ts`, mirroring the existing dialogue handler security model (regex allowlist + path-prefix defence-in-depth).
- A pure TypeScript `renderChunksToMarkdown()` function in `gui/chunk-renderer.ts` merges token-level chunks and renders Markdown structurally consistent with the Python `serialize_messages_to_markdown()` output.
- Three new API routes in `server.ts`: chunk list, raw JSONL, and on-demand rendered Markdown.
- The work-package frontend view now fetches chunks and dialogues in parallel, preferring chunks when available and falling back to Markdown files for older runs — fully backward compatible.

**WP-007** closed out the session by updating all six project manifest documents across both `orchestrator/` and `mcp-server/`, ensuring future agents have accurate context.

---

## Work Package Summary

| WP | Title | Status | Tests |
|---|---|---|---|
| WP-001 | ChunkWriter class | COMPLETE | 42 new / 825 total |
| WP-002 | `astream()` integration into `node_fn()` | CANCELLED (WP succeeded; ledger lifecycle issue) | 19 new / 858 total |
| WP-003 | SIGTERM/SIGINT graceful shutdown | COMPLETE | 6 new / 837 total |
| WP-004 | MCP server chunk API handlers | COMPLETE | 17 new / 1,795 total |
| WP-005 | `renderChunksToMarkdown()` renderer | COMPLETE | 35 new / 1,795 total |
| WP-006 | GUI route wiring + frontend chunk view | COMPLETE | Full suite 1,795 |
| WP-007 | Project manifest documentation | COMPLETE | N/A |

> **WP-002 note:** The implementation was completed, reviewed, and all 7 acceptance criteria were met (858 tests passing, ruff clean). The work package was CANCELLED due to a ledger lifecycle issue in the documentation pipeline, not a code defect. All WP-002 code changes — `_derive_slug_dir()` helper, ChunkWriter OSError guard, `astream()` integration, langgraph pin bump — are present and verified in the codebase.

---

## Metrics

### Python Orchestrator (pytest)

| Metric | WP-001 | WP-002 | WP-003 |
|---|---|---|---|
| Tests passed | 825 | 858 | 837 |
| Tests failed | 0 | 0 | 0 |
| New tests added | 42 | 19 | 6 |
| Ruff violations | 0 | 0 | 0 |

### MCP Server / GUI (vitest)

| Metric | WP-004 | WP-005 | WP-006 |
|---|---|---|---|
| Tests passed | 1,795 | 1,795 | 1,795 |
| Tests failed | 0 | 0 | 0 |
| New tests added | 17 | 35 | — |
| TypeScript build errors | 0 | 0 | 0 |

### Pipeline Health

- **WPs with all stages PASS:** 6 / 6 (excluding CANCELLED WP-002)
- **Code review FAILs (rework cycles):** 1 (WP-002 — two blocking issues found and resolved)
- **Fix-Forwards applied by Reviewer:** 3 (WP-005 type annotation, WP-006 route comment, WP-001 no fix needed)
- **Documentation-forward items raised:** 8 across all WPs — all resolved

---

## Issues & Blockers Encountered

### WP-002 — Code Review FAIL (Resolved)

The Reviewer found two blocking issues during the first code review pass:

1. **Unguarded `ChunkWriter.__init__()` instantiation** — an `OSError` from `mkdir()` or `open()` propagated into the outer streaming `try` block and caused `stage_success=False` for an otherwise-healthy agent run. **Fix:** wrapped `ChunkWriter(...)` in `try/except OSError`, falling back to `_slug_dir=None` with a `WARNING` log — capture degrades gracefully without failing the stage.

2. **Three-site DRY violation in slug derivation** — the `slug_dir` composition logic was duplicated verbatim at three sites in `node_fn()`: the ChunkWriter setup block, the post-stream Markdown capture block, and the error-path Markdown capture block. **Fix:** extracted a module-level `_derive_slug_dir(project_path, workspace_root) -> Path | None` helper called once before the streaming block.

Both fixes were verified across multiple QA cycles before the code-review re-submission passed.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Shared Revision-Numbering Helper (Architectural Debt — Low Priority)

`chunk_writer.py` and `dialogue_writer.py` share **identical revision-numbering logic** (glob `{wp_id}-{stage}-r*.jsonl`, `rsplit('-r')`, `max + 1`). Consider extracting this into a `_next_revision(directory: Path, pattern: str) -> int` helper in `utils/__init__.py` or a dedicated `_revision.py` module.

### 2. `_CHUNK_HEADER` Mutation Risk (Hardening — Low Priority)

The `_CHUNK_HEADER` constant in `chunk_writer.py` is a module-level mutable `dict`. It is directly importable and externally mutable; silent mutation would corrupt all subsequent header lines. The `# DO NOT MUTATE` comment and module-docstring warning are in place. A future hardening step would wrap it with `types.MappingProxyType` — but this requires a custom `JSONEncoder` since Python 3.14 does not natively serialize `MappingProxyType`.

**Trigger:** Any future refactor that imports `_CHUNK_HEADER` for purposes other than testing.

### 3. `write_chunk()` — Only `OSError` Is Suppressed (API Contract — Medium)

`write_chunk()` suppresses `OSError` (file I/O errors) but allows `TypeError` from non-JSON-serializable values to propagate unhandled to the caller. This is correctly documented in the method docstring. Upstream callers passing untrusted chunk data from LangGraph streams should be aware. If upstream callers ever pass custom objects or sets, a `TypeError` catch with a `DEBUG` log should be added in a follow-on WP.

**Trigger:** Any caller passing non-primitive chunk data to `write_chunk()`.

### 4. `AIMessageChunk` with `id=None` — Silent Drop (Edge Case — Low Priority)

In `node_fn()`, chunks with `id=None` are stored under the `None` key in `_chunk_accumulator` (overwriting each other) and then dropped during `_msgs` reconstruction by the `if _mid is not None` guard. Modern LangGraph always assigns IDs, so this is benign in practice. A `log.debug` warning at accumulation time would surface this case if a provider ever emits un-ID'd chunks.

**Trigger:** Any LangGraph provider update that affects message ID assignment.

### 5. Frontend — Chunk-Priority Coverage Gap (Test Debt — Low Priority)

The `dialogue-qa.test.ts` test infrastructure always returns `chunks: []` to exercise the fallback path. No dedicated test covers the chunk-priority path (`getChunks` returning non-empty → `useChunks=true` → `getChunkRendered` called on click). This gap should be closed in the next MCP server test expansion.

**Trigger:** Next frontend test iteration for `work-package.js`.

### 6. `getChunks()` / `getDialogues()` — Stale `wpId` Guard (Minor Debt — Low Priority)

Both `api-client.js` functions append `?wp=encodeURIComponent(wpId)` unconditionally, even when `wpId` is `undefined`, resulting in a literal `?wp=undefined` query string. The server handles this gracefully (WP_ID_RE rejects it, returns `[]`), but a guard clause (`only append when wpId is truthy`) would be cleaner. The existing `buildQueryString()` helper already filters `undefined` values and could be leveraged.

**Trigger:** Next `api-client.js` refactor or cleanup pass.

### 7. Signal-Interrupted Runs — Integration Test Gap (Test Coverage — Low Priority)

The 6 new `TestRegisterSignalHandlers` unit tests cover `_register_signal_handlers()` in isolation. No test fires a real `SIGTERM` against a running dry-run to validate the end-to-end race path in `_run()` (the `asyncio.wait()` race between `graph_task` and `wait_task`). A future integration test at this level would complete the signal-handling coverage.

**Trigger:** Next major CLI test expansion or infrastructure test suite.

---

## Next Steps

### Immediate (High Value)

1. **Monitor WP-002 in production.** The `astream()` integration, `_derive_slug_dir()` helper, and `ChunkWriter` OSError guard are all live. Watch for `WARNING: Could not open chunk file` log entries in early runs — these would indicate filesystem permission or disk-full conditions degrading capture.

2. **Close the frontend chunk-priority test gap** (item 5 above). This is the only untested happy path in the Phase 2 delivery.

### Near-Term

3. **Disable the Phase 1 backward-compatible Markdown render** once Phase 2 GUI rendering is confirmed stable in production. The chunk JSONL is now the source of truth; the Markdown files are a derived view. Disabling the post-stream `write_dialogue()` call reduces per-stage I/O by one Markdown serialization pass.

4. **Add `TypeError` suppression to `write_chunk()`** with a `DEBUG` log if any upstream caller is found to pass non-primitive chunk data.

5. **Add `@vitest/coverage-v8` to the MCP server** to get branch coverage metrics. The test suite is comprehensive but lacks a coverage reporter.

### Long-Term

6. **Extract `_next_revision()` helper** when (if) a third writer type is added to `orchestrator/src/utils/`.

7. **Chunk replay tooling.** Now that raw LangGraph chunks are durably on disk, a future tool could replay any captured chunk JSONL through the renderer to regenerate Markdown, validate format evolution, or feed fine-tuning pipelines.

---

## Files Modified (Complete List)

### Orchestrator (Python)
- `orchestrator/src/utils/chunk_writer.py` *(new)*
- `orchestrator/src/nodes/__init__.py`
- `orchestrator/src/cli.py`
- `orchestrator/requirements.txt`
- `orchestrator/pyproject.toml`
- `orchestrator/tests/test_chunk_writer.py` *(new)*
- `orchestrator/tests/test_streaming_capture.py` *(new)*
- `orchestrator/tests/test_cli.py`
- `orchestrator/tests/test_nodes.py`
- `orchestrator/docs/public-api.md`
- `orchestrator/docs/jsonl-log-schema.md`
- `orchestrator/docs/agents/project-manifest/api-surface.md`
- `orchestrator/docs/agents/project-manifest/file-tree.md` *(new)*
- `orchestrator/docs/agents/project-manifest/data-flows.md` *(new)*
- `orchestrator/docs/agents/project-manifest/tech-stack.md` *(new)*
- `orchestrator/docs/agents/project-manifest/README.md`
- `orchestrator/README.md`
- `orchestrator/changelog.md`

### MCP Server / GUI (TypeScript)
- `mcp-server/src/utils/constants.ts`
- `mcp-server/gui/api.ts`
- `mcp-server/gui/chunk-renderer.ts` *(new)*
- `mcp-server/gui/server.ts`
- `mcp-server/gui/public/api-client.js`
- `mcp-server/gui/public/views/work-package.js`
- `mcp-server/tests/gui/api.test.ts`
- `mcp-server/tests/gui/chunk-renderer.test.ts` *(new)*
- `mcp-server/README.md`
- `mcp-server/docs/agents/project-manifest/api-surface.md`
- `mcp-server/docs/agents/project-manifest/file-tree.md`

### Context Files (auto-generated)
- `.context/orchestrator/*.md` (5 files regenerated)
- `.context/mcp-server/*.md` (9 files regenerated)
