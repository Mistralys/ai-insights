# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary

Enable dialogue capture (ChunkWriter) for the PM and Synthesis orchestrator stages, which are currently silently skipped because the capture gate requires a truthy `wp_id`. The fix removes the `wp_id` guard from three code sites in `orchestrator/src/nodes/__init__.py` and uses a `"project"` sentinel as the filename component for stages that lack a WP ID. This produces chunk files named `project-pm-r0.jsonl` and `project-synthesis-r0.jsonl` alongside existing WP-scoped files, making PM reasoning, tool call arguments, and Synthesis output available for post-run diagnostics.

## Architectural Context

The orchestrator's streaming pipeline is implemented in `orchestrator/src/nodes/__init__.py`. The `create_stage_node()` factory produces async `node_fn()` closures that:

1. Derive a `_slug_dir` from `project_path` via `_derive_slug_dir()` (line ~150).
2. Pass `_slug_dir` and `_wp_id` to `_accumulate_stream()` (line ~412), which instantiates a `ChunkWriter` when `slug_dir is not None`.
3. After accumulation, optionally emit a `dialogue_captured` log entry (line ~916).

All three sites gate on `_wp_id` being truthy. PM and Synthesis stages always have `_wp_id = ""`, so capture is structurally disabled for them.

The `ChunkWriter` class (`orchestrator/src/utils/chunk_writer.py`) accepts any string for `wp_id` — it is used purely as a filename component via `f"{wp_id}-{stage}-r{revision}.jsonl"`. The revision utility (`orchestrator/src/utils/_revision.py`) globs `{wp_id}-{stage}-r*{ext}`, which works with any valid filename string.

Key files:
- `orchestrator/src/nodes/__init__.py` — capture gate, `_derive_slug_dir()`, `_accumulate_stream()`, `dialogue_captured` entry
- `orchestrator/src/utils/chunk_writer.py` — `ChunkWriter` class (no changes needed)
- `orchestrator/src/utils/_revision.py` — `next_revision()` (no changes needed)
- `orchestrator/tests/test_streaming_capture.py` — existing capture integration tests
- `orchestrator/tests/test_chunk_writer.py` — existing ChunkWriter unit tests
- `orchestrator/tests/conftest.py` — `_StreamCaptureConfig`, `_NoCaptureConfig` stubs

## Approach / Architecture

Remove the `_wp_id` guard from the three capture-related code paths in `create_stage_node()` → `node_fn()`. When `_wp_id` is falsy, substitute the sentinel string `"project"` before passing it to `_accumulate_stream()`, so the `ChunkWriter` receives a valid filename component. No changes are needed to `ChunkWriter` or `_revision.py` — they already handle arbitrary strings.

The `dialogue_captured` log entry will use `wp_id: "project"` in the filename path but record the actual empty `_wp_id` value in the log event itself, preserving log conventions (the `wp_id` field in log entries is either a real WP ID or empty).

## Rationale

This is the minimal fix that closes the diagnostic blind spot. The research paper (`docs/agents/research/2026-07-03-pm-dialogue-capture-gap.md`) demonstrates that PM and Synthesis stages are the two most strategically important stages for debugging (PM decisions drive the entire run; Synthesis produces the project summary), yet their full output is discarded. The `ChunkWriter` infrastructure already exists and handles arbitrary `wp_id` strings — the only barrier is the three truthy-`_wp_id` guards in the capture pipeline.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Sentinel value for empty `wp_id` | `"project"` string sentinel | (a) Empty string passthrough; (b) `None` with special handling; (c) New `ProjectChunkWriter` subclass | `"project"` is the simplest: it produces self-describing filenames (`project-pm-r0.jsonl`), requires zero changes to `ChunkWriter` or `_revision`, and clearly distinguishes project-level from WP-level captures in directory listings. Empty string would produce `-pm-r0.jsonl` (ugly, ambiguous). A subclass adds unnecessary abstraction for what is a one-line substitution. |
| Log entry `wp_id` value | Empty string in log, `"project"` in filename only | (a) `"project"` everywhere; (b) Omit `wp_id` field entirely | Keeping `wp_id: ""` in the log preserves the existing convention that `wp_id` is either a real WP ID or empty. The filename is a storage detail; the log is a semantic record. |

## Pattern Alignment

- **`{wp_id}-{stage}-r{revision}.jsonl` filename pattern** (`orchestrator/src/utils/chunk_writer.py`): Followed. The sentinel `"project"` slots into the existing `wp_id` position, producing `project-pm-r0.jsonl`.
- **Capture gating on `_app_config.capture_dialogues`** (`orchestrator/src/nodes/__init__.py`): Followed — the master toggle remains authoritative. The change only removes the additional `_wp_id` sub-gate.
- **Non-fatal capture errors** (`orchestrator/src/nodes/__init__.py`, line ~930): Followed — the `dialogue_captured` block remains wrapped in try/except with `log.debug`.
- **Test fixtures** (`orchestrator/tests/conftest.py`): Followed — existing `_StreamCaptureConfig` and `_NoCaptureConfig` stubs are reused for new tests.

## Detailed Steps

### Step 1: Remove the `_wp_id` guard from the capture gate

In `orchestrator/src/nodes/__init__.py`, in `node_fn()` inside `create_stage_node()`, change the capture gate from:

```python
if _app_config.capture_dialogues and _wp_id:
```

to:

```python
if _app_config.capture_dialogues:
```

This is at approximately line 890 (the `_slug_dir` derivation block).

### Step 2: Substitute `"project"` sentinel for empty `wp_id`

In the same function, after the capture gate, compute the effective `wp_id` for capture purposes:

```python
_capture_wp_id = _wp_id or "project"
```

Pass `_capture_wp_id` (instead of `_wp_id`) as the `wp_id` argument to `_accumulate_stream()`. This ensures the `ChunkWriter` receives `"project"` when the stage has no WP ID.

### Step 3: Remove the `_wp_id` guard from the `dialogue_captured` gate

Change the `dialogue_captured` gate from:

```python
if _app_config.capture_dialogues and _wp_id and _chunk_file_path is not None:
```

to:

```python
if _app_config.capture_dialogues and _chunk_file_path is not None:
```

Keep the `wp_id` field in the log entry as the original `_wp_id` (empty string for PM/Synthesis), not the sentinel.

### Step 4: Update `test_no_chunk_file_when_wp_id_empty` to expect capture

In `orchestrator/tests/test_streaming_capture.py`, the existing test `test_no_chunk_file_when_wp_id_empty` asserts that when `wp_id` is empty (synthesis), NO chunk file is written. This test must be inverted to assert that a chunk file IS written with the `project-` prefix.

Rename the test to `test_chunk_file_created_when_wp_id_empty` and update it to:
- Assert that a chunk file exists in the expected chunks directory.
- Assert the filename starts with `project-synthesis-`.
- Assert the file contains a valid JSONL header and chunk data.

### Step 5: Add test for PM stage capture

Add a new test `test_chunk_file_created_for_pm_stage` that:
- Uses `make_pm_node` with `_StreamCaptureConfig`.
- Passes a state with `current_wp_id=""` and valid `plan_file`/`project_path`.
- Asserts a chunk file exists with filename starting with `project-pm-`.

### Step 6: Add test for `dialogue_captured` log entry with empty `wp_id`

Add a new test `test_dialogue_captured_event_with_empty_wp_id` that:
- Runs a synthesis (or PM) stage with capture enabled.
- Asserts the `run_log` contains a `dialogue_captured` entry.
- Asserts the `wp_id` field in that entry is `""` (not `"project"`).
- Asserts the `file_path` field contains `project-` in the filename.

### Step 7: Add test that `capture_dialogues=False` still disables capture for project stages

Add a test `test_no_chunk_file_when_capture_false_for_project_stage` that:
- Uses `_NoCaptureConfig` with a synthesis stage and empty `wp_id`.
- Asserts no chunk files are written (confirming the master toggle still works).

## Dependencies

- No external dependencies. All changes are within the orchestrator sub-project.
- Steps 1–3 are code changes in one file. Steps 4–7 are test changes in one file.
- Steps 4–7 depend on steps 1–3.

## Required Components

- `orchestrator/src/nodes/__init__.py` — 3 edits (steps 1–3)
- `orchestrator/tests/test_streaming_capture.py` — 1 update + 3 new tests (steps 4–7)

## Assumptions

- The `ChunkWriter` handles the string `"project"` correctly as a `wp_id`. Verified: `ChunkWriter.__init__()` uses `wp_id` only in `f"{wp_id}-{stage}-r{revision}.jsonl"` — any valid filename string works.
- The `next_revision()` function handles the glob `project-{stage}-r*.jsonl` correctly. Verified: `next_revision()` uses `f"{wp_id}-{stage}-r*{ext}"` — `"project"` is a valid glob component.
- PM stages receive `current_wp_id=""` consistently. Verified: research paper confirms PM and Synthesis always have `wp_id=""`.
- The `_derive_slug_dir()` function does not use `wp_id` — it derives the slug directory from `project_path` only. Verified by reading the function body.

## Constraints

- The `dialogue_captured` log entry must preserve `wp_id: ""` for PM/Synthesis stages to maintain log convention consistency (the `wp_id` field is either a real WP ID or empty — never a sentinel).
- No changes to `ChunkWriter` or `_revision.py` — the fix must be scoped to the capture pipeline in `__init__.py`.
- Existing WP-scoped capture behavior must remain unchanged.

## Out of Scope

- **Extended thinking capture:** Whether Anthropic's extended thinking blocks appear in the `AIMessageChunk` stream is an open question noted in the research paper. This plan does not address it — the fix captures whatever the stream provides.
- **Chunk file pruning:** The research paper notes that no pruning policy exists for any chunk files. This is an existing gap that applies equally to WP-scoped chunks and is not addressed here.
- **Log reader updates:** `scripts/read-log.js` may benefit from displaying `project-` chunk references, but this is cosmetic and out of scope.

## Acceptance Criteria

1. When `capture_dialogues=True`, a PM stage run produces a chunk file named `project-pm-r{N}.jsonl` in `{slug_dir}/orchestrator/chunks/`.
2. When `capture_dialogues=True`, a Synthesis stage run produces a chunk file named `project-synthesis-r{N}.jsonl` in `{slug_dir}/orchestrator/chunks/`.
3. The `dialogue_captured` log entry is emitted for PM and Synthesis stages, with `wp_id: ""` and `format: "chunks"`.
4. When `capture_dialogues=False`, PM and Synthesis stages do NOT produce chunk files (master toggle still works).
5. Existing WP-scoped capture behavior (developer, QA, etc.) is unchanged.
6. All existing tests pass without modification (except the inverted `test_no_chunk_file_when_wp_id_empty`).
7. New tests cover PM capture, Synthesis capture, log entry format, and master toggle for project stages.

## Testing Strategy

Unit/integration tests using the existing mock-agent pattern in `test_streaming_capture.py`. All tests use `_StreamCaptureConfig` or `_NoCaptureConfig` from `conftest.py` with `tmp_path` for filesystem isolation. No real LLM or MCP calls. The mock agent pattern (`_make_stream_agent`) produces controlled `AIMessageChunk` streams that exercise the full capture pipeline.

## Test Plan

- `test_streaming_capture.py::TestChunkFileCreation::test_chunk_file_created_when_wp_id_empty` — Asserts a `project-synthesis-r0.jsonl` chunk file is created when synthesis runs with empty `wp_id` and capture enabled — AC 2, 7
- `test_streaming_capture.py::TestChunkFileCreation::test_chunk_file_created_for_pm_stage` — Asserts a `project-pm-r0.jsonl` chunk file is created when PM runs with empty `wp_id` and capture enabled — AC 1, 7
- `test_streaming_capture.py::TestChunkFileCreation::test_dialogue_captured_event_with_empty_wp_id` — Asserts `dialogue_captured` log entry is emitted with `wp_id: ""` and `file_path` containing `project-` — AC 3, 7
- `test_streaming_capture.py::TestChunkFileCreation::test_no_chunk_file_when_capture_false_for_project_stage` — Asserts no chunk files when `capture_dialogues=False` for synthesis with empty `wp_id` — AC 4, 7

## Documentation Updates

- `orchestrator/docs/agents/project-manifest/constraints.md` — No new constraints needed; the existing capture behavior description may reference the `project-` filename convention for completeness, but this is optional.
- `orchestrator/changelog.md` — Add entry documenting the capture gate fix (done by Release Engineer, not part of implementation).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **PM chunks may be large on opus models** | Accepted. The research paper notes that the PM stage consumed 69,801 tokens in one run. Chunk files will be proportionally large. This is acceptable given the diagnostic value, and pruning is an existing policy gap for all chunk files. |
| **`"project"` sentinel appears in unexpected code paths** | The sentinel is introduced as a local variable (`_capture_wp_id`) scoped to the capture pipeline. It is never written to state, log entries, or MCP tool calls — only to the chunk filename. |
| **Test inversion may miss edge cases** | The inverted test (`test_chunk_file_created_when_wp_id_empty`) is accompanied by three additional tests covering PM capture, log entry format, and master toggle. Together they provide full coverage of the new behavior. |
