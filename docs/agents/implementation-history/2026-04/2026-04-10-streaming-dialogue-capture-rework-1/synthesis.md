## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- **Step 1 — Shared revision helper:** Extracted `next_revision()` into
  `orchestrator/src/utils/_revision.py`. Both `chunk_writer.py` and
  `dialogue_writer.py` now import and delegate to this single helper,
  eliminating the duplicated glob-based revision logic.
- **Step 2 — Immutable `_CHUNK_HEADER`:** Wrapped the module-level
  `_CHUNK_HEADER` dict in `types.MappingProxyType` to enforce runtime
  immutability. Write sites convert back via `dict()` before
  `json.dumps()`.
- **Step 3 — `TypeError` suppression in `write_chunk()`:** The `except`
  clause in `ChunkWriter.write_chunk()` now catches
  `(OSError, TypeError)`, covering both I/O failures and serialisation
  errors from unexpected chunk payloads. The log message was generalised
  from `"I/O error"` to `"error writing to"`.
- **Step 4 — Debug log for `id=None` chunks:** Added a `log.debug()`
  call in `node_fn()` when an `AIMessageChunk` arrives with `id=None`,
  aiding stream diagnostics without altering control flow.
- **Step 5 — `buildQueryString()` in `getChunks()`/`getDialogues()`:**
  Both functions in `api-client.js` now use the existing
  `buildQueryString()` helper instead of manual string concatenation,
  eliminating the risk of `?wp=undefined` URLs.
- **Step 6 — Chunk-priority test gap:** Added three new tests in
  `dialogue-qa.test.ts` (`Chunk-priority path`) verifying chunks as the
  data source, correct `getChunkRendered` dispatch on click, and
  chunk-over-dialogue priority. Added two `wpId=undefined guard` tests.
- **Step 7 — `@vitest/coverage-v8`:** Added as a dev dependency and
  exposed via a new `test:coverage` npm script. Verified functional.
- **Step 8 — Removed Markdown dialogue render:** Deleted the
  `serialize_messages_to_markdown` + `write_dialogue` import and both
  the success-path and error-path Markdown render blocks from
  `node_fn()` in `__init__.py`. Removed the outer `TypeError`
  fallback wrapper (now handled internally by `write_chunk()`).

### Documentation Updates
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Added
  `_revision.py` entry.
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Added
  `_revision` module section with `next_revision()` signature; updated
  `_CHUNK_HEADER` to note `MappingProxyType`; updated `write_chunk()`
  description for `TypeError` suppression.
- `orchestrator/docs/agents/project-manifest/data-flows.md` — Updated
  Flow 1 (Markdown dialogue) to note module-only usage; updated Flow 2
  (JSONL chunk) for shared revision helper and `TypeError` handling;
  updated relationship table.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — Added
  `@vitest/coverage-v8` to dev dependency table.

### Verification Summary
- **Orchestrator tests:** `python -m pytest` — 870 passed, 6 skipped,
  0 failures.
  - `test_revision.py` — 11 passed (new file).
  - `test_chunk_writer.py` — 46 passed (updated assertions).
  - `test_nodes.py` — 158 passed (updated for Markdown removal).
  - `test_streaming_capture.py` — 18 passed (removed obsolete patches,
    replaced `TestMarkdownDialogueBackwardCompat` with
    `TestNoMarkdownDialogue`, rewrote
    `test_partial_msgs_available_after_stream_error` →
    `test_partial_chunks_written_before_stream_error`).
- **MCP server tests:** `npm test` — 1800 passed across 59 test files.
  - `dialogue-qa.test.ts` — 31 passed (5 new tests).
- **Coverage tooling:** `npm run test:coverage` — verified functional
  with `@vitest/coverage-v8`.
- **Static analysis:** No lint/type regressions introduced. Pre-existing
  Pydantic V1 deprecation warning on Python 3.14 is out of scope.
- Result: All tests pass. No regressions.

### Code Insights
- [medium] (refactor) `orchestrator/tests/test_streaming_capture.py`:
  The `_StreamCaptureConfig` and `_NoCaptureConfig` helper classes are
  duplicated across `test_streaming_capture.py`, `test_nodes.py`, and
  `test_chunk_writer.py`. Extracting them into a shared `conftest.py`
  would reduce drift and maintenance burden.
- [low] (convention) `orchestrator/src/utils/dialogue_writer.py`: After
  the Markdown render removal from `node_fn()`, `write_dialogue()` is
  no longer called by the pipeline. The module is retained for manual
  use, but a deprecation notice or explicit "manual-use-only" docstring
  would clarify intent for future contributors.
- [low] (improvement) `mcp-server/gui/public/api-client.js`: The
  `buildQueryString()` helper silently drops keys with `undefined`
  values, which is the correct behaviour for the `wpId` guard. However,
  a JSDoc comment on `buildQueryString()` documenting this
  undefined-dropping contract would prevent accidental regressions if
  someone refactors the helper.
- [low] (debt) `orchestrator/src/nodes/__init__.py`: The `node_fn()`
  closure is ~200 lines. Now that the Markdown path is removed, the
  remaining logic (stream accumulation, chunk writing, error handling,
  log event construction) could benefit from extracting helper functions
  for readability — but this is a larger refactor best tracked as a
  separate work package.

### Additional Comments
- The two out-of-scope items from the plan (signal-integration test and
  chunk replay tooling) remain unimplemented as intended.
- `dialogue_writer.py` retains `write_dialogue()` and
  `serialize_messages_to_markdown()` for manual/scripted use. Only the
  automated pipeline call from `node_fn()` was removed.
