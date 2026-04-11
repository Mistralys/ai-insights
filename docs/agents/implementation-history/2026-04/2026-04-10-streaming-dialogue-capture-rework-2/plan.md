# Plan

## Summary

Address the four strategic recommendations from the
`2026-04-10-streaming-dialogue-capture-rework-1` synthesis: extract
duplicated test config helpers into a shared `conftest.py`, add a
manual-use-only notice to `dialogue_writer.py`, document the
`undefined`-dropping contract of `buildQueryString()`, and decompose the
~400-line `node_fn()` closure into named helper functions.

## Architectural Context

- **Orchestrator test helpers:** `_StreamCaptureConfig` and
  `_NoCaptureConfig` are defined identically in
  `orchestrator/tests/test_streaming_capture.py` (lines 31–70) and
  `orchestrator/tests/test_nodes.py` (line 937–952). There is no
  `conftest.py` in `orchestrator/tests/`. Note: the original synthesis
  listed `test_chunk_writer.py` as a third duplication site, but
  codebase review shows that file does **not** contain these classes.
- **`dialogue_writer.py`:** Located at
  `orchestrator/src/utils/dialogue_writer.py`. After the rework-1 plan
  removed the `write_dialogue()` call from `node_fn()`, this module is
  no longer invoked by the pipeline. The module-level docstring still
  presents it as an active "Public API" with no deprecation or
  manual-use caveat.
- **`buildQueryString()`:** Located at
  `mcp-server/gui/public/api-client.js` (lines 31–36). The function
  filters out keys with `undefined` or empty-string values. There is no
  JSDoc comment documenting this contract.
- **`node_fn()` closure:** Located at
  `orchestrator/src/nodes/__init__.py`, lines 333–734 (~400 lines). It
  handles stream accumulation, chunk writing, error handling, rollback
  logic, and log event construction — all in a single nested closure.

## Approach / Architecture

Each recommendation is an independent, low-risk change:

1. **Shared `conftest.py`** — Create
   `orchestrator/tests/conftest.py`, move `_StreamCaptureConfig` and
   `_NoCaptureConfig` there, and remove the duplicate definitions from
   the two consuming test files. pytest discovers `conftest.py`
   fixtures/helpers automatically.
2. **`dialogue_writer.py` docstring** — Prepend a "Manual-use only"
   notice to the module docstring. No code change.
3. **`buildQueryString()` JSDoc** — Add a `/** … */` block above the
   function documenting the `undefined`/empty-string filtering contract.
4. **`node_fn()` decomposition** — Extract coherent blocks into named
   helper functions within the same module (private, prefixed with `_`).
   Candidates for extraction:
   - Stream accumulation loop (collecting `AIMessageChunk`s).
   - Error handling + rollback logic.
   - Log-entry construction (start entry, success entry, error entry).
   - `ChunkWriter` lifecycle (open, write, close).

## Rationale

- Items 1–3 are documentation/hygiene fixes that reduce drift risk and
  clarify intent with minimal change surface.
- Item 4 improves readability of the most complex function in the
  orchestrator without changing behaviour, making future changes safer.

## Detailed Steps

1. **Create `orchestrator/tests/conftest.py`** containing
   `_StreamCaptureConfig` and `_NoCaptureConfig`, consolidating both
   existing implementations into one canonical version. Use the version
   from `test_streaming_capture.py` as the base (it accepts
   `workspace_root` in `__init__`).
2. **Update `orchestrator/tests/test_streaming_capture.py`:** Remove the
   `_StreamCaptureConfig` and `_NoCaptureConfig` class definitions
   (lines 31–70). Imports will resolve automatically via pytest's
   conftest mechanism — no explicit import needed.
3. **Update `orchestrator/tests/test_nodes.py`:** Remove the
   `_NoCaptureConfig` class definition (lines 937–952). Same conftest
   mechanism applies.
4. **Update `orchestrator/src/utils/dialogue_writer.py`:** Revise the
   module-level docstring to open with a notice that this module is
   retained for manual/scripted use only and is no longer called by the
   automated pipeline.
5. **Update `mcp-server/gui/public/api-client.js`:** Add a JSDoc
   comment above `buildQueryString()` documenting that keys with
   `undefined` or empty-string values are silently omitted from the
   output.
6. **Decompose `node_fn()` in
   `orchestrator/src/nodes/__init__.py`:** Extract the following
   helpers (all module-private):
   - `_build_start_log_entry(…)` — Construct the `stage_start` log
     dict.
   - `_build_success_log_entry(…)` — Construct the `stage_complete`
     log dict.
   - `_build_error_log_entry(…)` — Construct the `stage_error` log
     dict.
   - `_accumulate_stream(…)` — The async generator consumer that
     collects chunks and writes to `ChunkWriter`.
   - `_handle_rollback(…)` — Pipeline-failure rollback logic.
7. **Run orchestrator tests** (`python -m pytest`) — all 870+ tests
   must pass. The conftest refactor and `node_fn` decomposition must
   not change behaviour.
8. **Run MCP server tests** (`npm test` from `mcp-server/`) — all
   1800+ tests must pass.
9. **Update manifest documentation:**
   - `orchestrator/docs/agents/project-manifest/file-tree.md` — Add
     `conftest.py` entry.
   - `orchestrator/docs/agents/project-manifest/api-surface.md` — Add
     any newly extracted helper signatures (private, but documented for
     agent navigation).

## Dependencies

- Steps 1–3 are a single unit (conftest extraction).
- Steps 4 and 5 are fully independent of each other and of 1–3.
- Step 6 is independent but the largest piece of work.
- Steps 7–8 depend on all code changes being complete.
- Step 9 depends on step 1 (conftest file created) and step 6 (new
  helpers to document).

## Required Components

- `orchestrator/tests/conftest.py` (new file)
- `orchestrator/tests/test_streaming_capture.py` (edit)
- `orchestrator/tests/test_nodes.py` (edit)
- `orchestrator/src/utils/dialogue_writer.py` (edit — docstring only)
- `mcp-server/gui/public/api-client.js` (edit — comment only)
- `orchestrator/src/nodes/__init__.py` (edit — refactor)
- `orchestrator/docs/agents/project-manifest/file-tree.md` (edit)
- `orchestrator/docs/agents/project-manifest/api-surface.md` (edit)

## Assumptions

- `_StreamCaptureConfig` and `_NoCaptureConfig` are only used in the
  two identified test files (confirmed via workspace-wide grep).
- The `conftest.py` auto-discovery mechanism is sufficient — no
  explicit imports are needed for helpers defined there (pytest
  convention).
- `dialogue_writer.py` is intentionally retained for manual use; this
  plan does not remove it.

## Constraints

- No behavioural changes: all steps are refactors, documentation, or
  comments.
- The `node_fn()` decomposition must preserve the exact same return
  dict shape and error-handling semantics.
- Cross-platform: no OS-specific code introduced.

## Out of Scope

- Removing `dialogue_writer.py` entirely (retained for manual use).
- Signal-integration test and chunk-replay tooling (deferred from
  rework-1).
- Async refactoring of `node_fn()` beyond helper extraction.

## Acceptance Criteria

- `orchestrator/tests/conftest.py` exists and contains both config
  helper classes.
- No duplicate `_StreamCaptureConfig` or `_NoCaptureConfig` definitions
  remain in individual test files.
- `dialogue_writer.py` module docstring contains a manual-use-only
  notice.
- `buildQueryString()` has a JSDoc comment documenting undefined/empty
  filtering.
- `node_fn()` body is ≤ 200 lines, with extracted helpers covering
  log entry construction, stream accumulation, and rollback.
- All orchestrator tests pass (870+).
- All MCP server tests pass (1800+).
- Manifest `file-tree.md` and `api-surface.md` updated.

## Testing Strategy

All changes are refactors or documentation — no new tests are required.
Existing test suites serve as the regression safety net:

- **Orchestrator:** `python -m pytest` (870+ tests, including the
  streaming capture and node tests that exercise the refactored code).
- **MCP server:** `npm test` (1800+ tests, covering the GUI API client
  indirectly via `dialogue-qa.test.ts`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **conftest helpers not auto-discovered** | pytest discovers `conftest.py` by convention; verified by running the full test suite after extraction. |
| **`node_fn()` decomposition introduces subtle state bugs** | Each extracted helper is a pure-ish function with explicit parameters. Full test suite (158 node tests) provides regression coverage. |
| **JSDoc comment misinterpreted by a minifier** | `api-client.js` is served as-is (no build step); standard `/** */` syntax is safe. |
