# Plan

## Summary

Address all actionable items from the strategic recommendations and next steps identified in the streaming-dialogue-capture synthesis. This covers eight concrete changes across the orchestrator (Python) and MCP server GUI (TypeScript): extracting shared revision-numbering logic, hardening the `_CHUNK_HEADER` constant, adding `TypeError` suppression to `write_chunk()`, adding a debug log for `id=None` chunks, closing the frontend chunk-priority test gap, fixing the stale `wpId` guard in `getChunks()`/`getDialogues()`, adding `@vitest/coverage-v8` to the MCP server, and removing the backward-compatible Markdown dialogue render from `node_fn()`. Two long-term items (signal-integration test, chunk replay tooling) are explicitly out of scope.

## Architectural Context

The streaming-dialogue-capture session (2026-04-10) introduced:

- **`orchestrator/src/utils/chunk_writer.py`** — `ChunkWriter` class that writes raw LangGraph stream chunks to JSONL files with immediate `flush()`.
- **`orchestrator/src/utils/dialogue_writer.py`** — Pre-existing module that writes serialised Markdown dialogue files. Contains revision-numbering logic duplicated from `ChunkWriter`.
- **`orchestrator/src/nodes/__init__.py`** — `node_fn()` closure that now uses `astream()` with `ChunkWriter`, accumulating `AIMessageChunk` fragments per message ID.
- **`mcp-server/gui/public/api-client.js`** — Browser-side API client with `getChunks()`, `getDialogues()`, and `buildQueryString()` helper.
- **`mcp-server/gui/public/views/work-package.js`** — WP detail view that fetches chunks and dialogues in parallel, preferring chunks when available.
- **`mcp-server/tests/gui/dialogue-qa.test.ts`** — Frontend QA tests that currently always return empty chunks, never testing the chunk-priority path.
- **`mcp-server/gui/chunk-renderer.ts`** — Pure TypeScript renderer that converts chunk JSONL to Markdown.

## Approach / Architecture

Eight changes grouped into four logical areas:

1. **Orchestrator hardening** (steps 1–4): Extract shared revision helper, freeze `_CHUNK_HEADER`, suppress `TypeError` in `write_chunk()`, log `id=None` chunks.
2. **Remove Markdown dialogue render** (step 8): Delete the backward-compatible `serialize_messages_to_markdown()` + `write_dialogue()` calls from both the success and error paths in `node_fn()`. The chunk JSONL is now the durable source of truth; the GUI renders Markdown on demand from chunks.
3. **Frontend fixes** (steps 5–6): Use `buildQueryString()` in `getChunks()`/`getDialogues()`, add chunk-priority test coverage.
4. **Tooling** (step 7): Add `@vitest/coverage-v8` to MCP server dev dependencies.

All changes are independently deployable. Step 8 removes a code path (Markdown render) but does not break consumers — the GUI already prefers chunk JSONL when available and falls back to pre-existing Markdown files from older runs.

## Rationale

- Each item was identified during a production-quality code review (synthesis strategic recommendations 1–7 and next steps 2–5).
- All issues were verified against the current codebase — none are hypothetical.
- The changes are minimal and targeted, avoiding scope creep into the broader streaming system.
- Removing the Markdown render is safe because the GUI already prefers chunk JSONL and only falls back to Markdown for runs that predate streaming capture. No new Markdown files need to be produced going forward.

## Detailed Steps

### 1. Extract shared revision-numbering helper

**Source:** Synthesis recommendation #1

**Verified duplication:**
- `chunk_writer.py` lines 124–140: `ChunkWriter._next_revision()` static method — globs `{wp_id}-{stage}-r*.jsonl`, `rsplit('-r', 1)`, `max + 1`.
- `dialogue_writer.py` lines 238–260: identical logic inline within `write_dialogue()` — globs `{wp_id}-{stage}-r*.md`, `rsplit('-r', 1)`, `max + 1`.

**Action:**
- Create `orchestrator/src/utils/_revision.py` with a single function:
  ```python
  def next_revision(directory: Path, wp_id: str, stage: str, ext: str) -> int:
  ```
  The `ext` parameter (e.g. `".jsonl"`, `".md"`) replaces the hardcoded suffix in the glob pattern.
- Update `ChunkWriter._next_revision()` to delegate to `next_revision()`. Remove the static method and call the shared helper from `__init__`.
- Update `write_dialogue()` to call `next_revision()` instead of the inline logic.
- Add unit tests for `next_revision()` in a new `orchestrator/tests/test_revision.py`.

### 2. Harden `_CHUNK_HEADER` with `MappingProxyType`

**Source:** Synthesis recommendation #2

**Verified:** `_CHUNK_HEADER` is a plain mutable `dict` at module level in `chunk_writer.py` (lines 62–67). A `# DO NOT MUTATE` comment is present but unenforced.

**Action:**
- Wrap the dict with `types.MappingProxyType` to make it truly immutable at runtime.
- Since `json.dumps()` does not natively serialize `MappingProxyType`, convert to `dict()` at the single `json.dumps()` call site in `__init__` (line 113): `json.dumps(dict(_CHUNK_HEADER), ensure_ascii=False)`.
- Update existing tests that import `_CHUNK_HEADER` to verify it is a `MappingProxyType` (read-only assertion).

### 3. Add `TypeError` suppression to `write_chunk()`

**Source:** Synthesis recommendation #3 / Next step #4

**Verified:** `write_chunk()` in `chunk_writer.py` (lines 152–170) only catches `OSError`. A `TypeError` from `json.dumps()` propagates to the caller. While `node_fn()` has a `TypeError` fallback for metadata (lines 492–501 in `__init__.py`), the inner `msg.model_dump()` could also produce non-serializable values for exotic chunk types.

**Action:**
- Add `TypeError` to the `except` clause in `write_chunk()`, logging at `DEBUG` level (matching the `OSError` handling pattern).
- Update the docstring to reflect that both `OSError` and `TypeError` are now suppressed.
- Remove the outer `TypeError` fallback in `node_fn()` (lines 492–501 in `__init__.py`) since `write_chunk()` now handles it internally. This simplifies the calling code.
- Add a unit test that passes a non-serializable value (e.g. a `set`) to `write_chunk()` and verifies it does not raise and does not corrupt the file.

### 4. Add debug log for `AIMessageChunk` with `id=None`

**Source:** Synthesis recommendation #4

**Verified:** In `node_fn()` (`__init__.py` lines 504–534), chunks with `id=None` are stored under the `None` key in `_chunk_accumulator` (overwriting previous `None` entries) and later dropped by the `if _mid is not None` guard in the `finally` block. No diagnostic logging exists.

**Action:**
- In the `astream()` loop, when `isinstance(_msg, AIMessageChunk)` and `_msg.id` is `None`, emit a `log.debug()` before storing: `"AIMessageChunk with id=None received (stage %s); chunk will be dropped during message reconstruction."`.
- Add an inline comment explaining why `id=None` chunks are expected to be rare (modern LangGraph always assigns IDs) and can safely be dropped.
- No behavioral change — this is diagnostic-only.

### 5. Fix stale `wpId` guard in `getChunks()` / `getDialogues()`

**Source:** Synthesis recommendation #6

**Verified:** In `api-client.js` (lines 63–71), both functions directly concatenate `'?wp=' + encodeURIComponent(wpId)` without checking if `wpId` is defined. When `wpId` is `undefined`, `encodeURIComponent(undefined)` produces the literal string `"undefined"`, resulting in `?wp=undefined`. The server rejects this via `WP_ID_RE` and returns `[]`, so it's functionally harmless but produces unnecessary HTTP traffic and a misleading query string. The existing `buildQueryString()` helper (lines 29–34) already filters `undefined` values.

**Action:**
- Refactor `getDialogues()` and `getChunks()` to use `buildQueryString({ wp: wpId })` instead of manual concatenation.
- This makes both functions consistent with `getProjects()` which already uses `buildQueryString()`.
- Add a unit test (or update existing `dialogue-qa.test.ts`) that calls `getDialogues(slug, undefined)` and verifies the URL does not contain `wp=undefined`.

### 6. Close frontend chunk-priority test gap

**Source:** Synthesis recommendation #5 / Next step #2

**Verified:** In `dialogue-qa.test.ts`, every test case passes `{ match: '/chunks', body: [] }`, which forces `chunks.length === 0` → `useChunks = false`. No test exercises the chunk-priority path where `getChunks` returns non-empty data and `useChunks = true`.

**Action:**
- Add a new `describe` block in `dialogue-qa.test.ts` (or in a separate `chunk-priority.test.ts`) covering:
  1. When `getChunks` returns non-empty results, the view should use chunks (not dialogues) as the data source.
  2. Clicking a dialogue button with `data-use-chunks="1"` should call `API.getChunkRendered()` (not `API.getDialogueContent()`).
  3. The rendered Markdown from chunks should be displayed in the dialogue content area.
  4. When `getChunks` returns entries and `getDialogues` also returns entries, chunks take priority.
- Mock `getChunks` to return `[{ filename: 'WP-001-developer-r0.jsonl', stage: 'developer' }]` and `getChunkRendered` to return rendered Markdown.

### 7. Add `@vitest/coverage-v8` to MCP server

**Source:** Next step #5

**Verified:** `mcp-server/package.json` lists `vitest` as a dev dependency but has no coverage reporter. No `@vitest/coverage-v8` or equivalent is present.

**Action:**
- Add `@vitest/coverage-v8` as a dev dependency in `mcp-server/package.json`.
- Add a `test:coverage` script: `"test:coverage": "vitest run --coverage"`.
- Add a `coverage` section to `mcp-server/vitest.config.ts` if needed (reporter, thresholds are optional for now — the goal is to enable coverage reporting, not enforce thresholds).
- Run `npm install` and `npm run test:coverage` to verify it works.

### 8. Remove backward-compatible Markdown dialogue render from `node_fn()`

**Source:** Synthesis next step #3

**Verified:** In `orchestrator/src/nodes/__init__.py`, `node_fn()` writes Markdown dialogue files in two places:

1. **Success path** (after stream completion): calls `serialize_messages_to_markdown(_msgs, stage, _wp_id, ts_str)` → `write_dialogue(content, slug_dir, _wp_id, stage)`, emitting a `dialogue_captured` JSONL event.
2. **Error path** (in the `except` block, when `_msgs` is non-empty): calls the same `serialize_messages_to_markdown()` → `write_dialogue()` pair, emitting a `dialogue_captured` event with `partial: True`.

Both paths are now redundant because:
- The `ChunkWriter` writes every stream chunk to JSONL with immediate `flush()` — the chunk file is already on disk before the Markdown render would run.
- The GUI already prefers chunk JSONL when available (`useChunks = chunks.length > 0`) and renders Markdown on demand via `renderChunksToMarkdown()`.
- Pre-existing Markdown files from older runs are still served by `handleListDialogues()` / `handleGetDialogueFile()` — no deletion needed.

**Action:**
- **Success path:** Remove the entire `# ── Markdown dialogue file (backward-compatible)` block (the `try/except` that calls `serialize_messages_to_markdown()` + `write_dialogue()` and emits the `dialogue_captured` event without `format` key). Keep the chunk-captured event block unchanged.
- **Error path:** Remove the `# ── error-path dialogue capture (best-effort)` block (the `if _app_config.capture_dialogues and _wp_id and _msgs:` section that calls the same functions with `partial: True`). The chunk JSONL already contains all chunks written before the exception, which is a superset of what the Markdown render would have captured.
- Remove the `dialogue_captured_entry` variable and its reference in the `extra_log_entries` list (success path). The `chunk_captured_entry` remains.
- Remove the `err_dialogue_entry` variable from the error path's `rollback_log_entries`.
- Remove the `serialize_messages_to_markdown` and `write_dialogue` imports from the top of `__init__.py` if they become unused (verify no other code path uses them).
- Update existing tests in `orchestrator/tests/test_nodes.py` that assert on `dialogue_captured` events for Markdown files — these should now only expect `dialogue_captured` events with `"format": "chunks"`.
- The `dialogue_writer.py` module itself is **not** deleted — it may still be used by other consumers or for manual invocation. Only the calls from `node_fn()` are removed.

## Dependencies

- No new production dependencies.
- `@vitest/coverage-v8` — new dev dependency for MCP server only (step 7).
- `types.MappingProxyType` — Python stdlib, no install needed (step 2).

## Required Components

### New files
- `orchestrator/src/utils/_revision.py` — Shared revision-numbering helper (step 1).
- `orchestrator/tests/test_revision.py` — Tests for the revision helper (step 1).

### Modified files
- `orchestrator/src/utils/chunk_writer.py` — Use shared revision helper; harden `_CHUNK_HEADER`; suppress `TypeError` in `write_chunk()` (steps 1, 2, 3).
- `orchestrator/src/utils/dialogue_writer.py` — Use shared revision helper (step 1).
- `orchestrator/src/nodes/__init__.py` — Add `id=None` debug log; remove outer `TypeError` fallback; remove backward-compatible Markdown render from success and error paths (steps 3, 4, 8).
- `orchestrator/tests/test_nodes.py` — Update `dialogue_captured` event assertions to expect only `format: "chunks"` events (step 8).
- `mcp-server/gui/public/api-client.js` — Use `buildQueryString()` in `getChunks()`/`getDialogues()` (step 5).
- `mcp-server/tests/gui/dialogue-qa.test.ts` — Add chunk-priority test cases (step 6), optionally test `wpId=undefined` (step 5).
- `mcp-server/package.json` — Add `@vitest/coverage-v8` dev dependency and `test:coverage` script (step 7).
- `mcp-server/vitest.config.ts` — Optionally add coverage configuration (step 7).

### Manifest documents to update
- `orchestrator/docs/agents/project-manifest/file-tree.md` — Add `_revision.py`.
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Document `next_revision()` function.
- `orchestrator/docs/agents/project-manifest/data-flows.md` — Update dialogue capture flow to reflect that Markdown render is removed and only chunk JSONL is written.
- `mcp-server/docs/agents/project-manifest/tech-stack.md` — Add `@vitest/coverage-v8` dev dependency.

## Assumptions

- The revision-numbering logic in both modules is functionally identical and can be unified without behavioral change.
- `MappingProxyType` wrapped dicts are accepted by all test assertions that currently inspect `_CHUNK_HEADER` (e.g. `assert _CHUNK_HEADER["chunk_format"] == 1` — indexing works on `MappingProxyType`).
- The `node_fn()` outer `TypeError` fallback (retry without metadata) can be fully removed once `write_chunk()` suppresses `TypeError` internally — the fallback becomes redundant since `write_chunk()` will simply log and skip the bad chunk.
- Adding `@vitest/coverage-v8` has no impact on existing test behavior; it only adds a `--coverage` reporting option.

## Constraints

- Cross-platform: All Python changes must use `pathlib.Path`. No OS-specific APIs.
- The `_revision.py` module must remain zero-dependency (stdlib only).
- `_CHUNK_HEADER` must remain importable for test assertions — only mutation is prevented, not read access.
- The `wpId` guard fix must not change API behavior for callers that pass a valid `wpId`; it only affects the `undefined` case.
- All changes must pass the existing test suites (`pytest` for orchestrator, `vitest run` for MCP server) without modification to passing tests.

## Out of Scope

- **Signal-interrupted runs integration test** (synthesis recommendation #7). Requires firing a real `SIGTERM` against a running dry-run process, which is infrastructure-heavy and deferred to a dedicated CLI test expansion effort.
- **Chunk replay tooling** (next step #7). Novel feature, not a fix. Tracked for future consideration.
- **Deleting `dialogue_writer.py`.** The module may be used outside `node_fn()` or for manual invocation. Only the calls from `node_fn()` are removed.
- **Deleting pre-existing Markdown dialogue files.** Old files from runs before streaming capture remain on disk and are still served by the GUI's dialogue endpoints.
- **Coverage thresholds.** Step 7 enables coverage reporting but does not enforce minimum thresholds.

## Acceptance Criteria

- `orchestrator/src/utils/_revision.py` exists with a `next_revision()` function and is called by both `chunk_writer.py` and `dialogue_writer.py`.
- `_CHUNK_HEADER` is a `MappingProxyType` instance. Attempting `_CHUNK_HEADER["foo"] = "bar"` raises `TypeError`.
- `write_chunk()` suppresses `TypeError` from non-serializable values and logs at `DEBUG`; no exception propagates to the caller.
- A `log.debug` message is emitted when an `AIMessageChunk` with `id=None` is received during streaming.
- `API.getChunks(slug, undefined)` and `API.getDialogues(slug, undefined)` produce URLs without `?wp=undefined`.
- At least one test in the MCP server GUI test suite exercises the chunk-priority path (`useChunks=true` → `getChunkRendered` called on click).
- `npm run test:coverage` in `mcp-server/` produces a coverage report.
- After step 8, `node_fn()` no longer calls `serialize_messages_to_markdown()` or `write_dialogue()`. No Markdown dialogue files are produced for new runs.
- After step 8, the only `dialogue_captured` JSONL events emitted by `node_fn()` have `"format": "chunks"`.
- All existing tests continue to pass: orchestrator (pytest) and MCP server (vitest).

## Testing Strategy

### Orchestrator (pytest)
- **`test_revision.py`:** Unit tests for `next_revision()` — empty directory (returns 0), single existing file (returns 1), multiple files with gaps (returns max+1), non-matching files ignored, edge cases (malformed filenames).
- **`test_chunk_writer.py`:** Update existing tests to verify `_CHUNK_HEADER` is `MappingProxyType`. Add test for `TypeError` suppression in `write_chunk()`.
- **`test_nodes.py` or `test_streaming_capture.py`:** Verify that the `TypeError` fallback in `node_fn()` is removed and that `write_chunk()` suppression handles it.
- **`test_nodes.py`:** Update `TestDialogueCaptured` tests — assertions should only expect `dialogue_captured` events with `"format": "chunks"`. Remove any assertions that check for Markdown file paths or events without a `format` field.
- **Regression:** Full `pytest` suite must pass.

### MCP Server (vitest)
- **`dialogue-qa.test.ts`:** Add chunk-priority tests (non-empty chunks → `useChunks=true` → `getChunkRendered` called).
- **`api-client` or inline test:** Verify `getDialogues(slug, undefined)` URL formation.
- **Coverage:** Run `npm run test:coverage` and verify report is generated.
- **Regression:** Full `vitest run` suite must pass.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`MappingProxyType` breaks test assertions that use `dict()` comparison.** | `MappingProxyType` supports `==` comparison with `dict`. Verify in tests. Only `isinstance(x, dict)` checks would break — search for any such checks before merging. |
| **Removing the `TypeError` fallback in `node_fn()` causes chunk data loss.** | `write_chunk()` now handles `TypeError` internally. The net effect is identical: the bad chunk is skipped. The only difference is the error path (log + skip) happens inside `write_chunk()` instead of outside. |
| **`buildQueryString()` changes URL encoding behavior.** | `buildQueryString()` uses the same `encodeURIComponent()` as the manual concatenation. The only behavioral change is when `wpId` is `undefined` (no query param emitted instead of `?wp=undefined`). |
| **`@vitest/coverage-v8` version incompatibility with vitest 4.x.** | Install the matching major version (`@vitest/coverage-v8@^4`). Run the test suite after installation to verify. |
| **Removing Markdown render breaks consumers of `dialogue_captured` events without `format` field.** | Search for any JSONL log consumers that filter on `dialogue_captured` without a `format` key. The `scripts/read-log.js` log reader and `mcp-server/gui` run-log view render all events generically; they do not branch on `format`. The only consumer-visible change is that new runs produce fewer `dialogue_captured` events (chunks only, no Markdown). |
