## Synthesis

### Completion Status
- Date: 2026-07-03
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-03

### Implementation Summary
- Removed the `_wp_id` truthy guard from the `_slug_dir` derivation block in `create_stage_node()` → `node_fn()` in `orchestrator/src/nodes/__init__.py`, enabling `ChunkWriter` to be instantiated for PM and Synthesis stages.
- Introduced `_capture_wp_id = _wp_id or "project"` as a local sentinel, passed to `_accumulate_stream()` in place of `_wp_id`. This produces chunk files named `project-pm-r{N}.jsonl` and `project-synthesis-r{N}.jsonl`, matching the existing `{wp_id}-{stage}-r{N}.jsonl` naming convention.
- Removed the `_wp_id` guard from the `dialogue_captured` log entry gate. The entry still records `wp_id: _wp_id` (empty string for PM/Synthesis), preserving log conventions. Only the chunk filename uses the sentinel.
- Inverted `test_no_chunk_file_when_wp_id_empty` → `test_chunk_file_created_when_wp_id_empty` in `test_streaming_capture.py` to assert a `project-synthesis-r*.jsonl` file is created.
- Added `test_chunk_file_created_for_pm_stage` asserting a `project-pm-r*.jsonl` file is created.
- Added `test_dialogue_captured_event_with_empty_wp_id` asserting the `dialogue_captured` log entry is emitted with `wp_id: ""` and `file_path` containing `project-`.
- Added `test_no_chunk_file_when_capture_false_for_project_stage` confirming the master toggle still disables capture for project-level stages.
- Inverted `test_dialogue_captured_not_emitted_when_wp_id_empty` → `test_dialogue_captured_emitted_when_wp_id_empty` in `test_nodes.py` to reflect the new behavior.

### Documentation Updates
- No documentation updates were required. The plan explicitly deferred changelog updates to the Release Engineer.

### Verification Summary
- Tests run: `orchestrator/tests/` full suite (pytest)
- Static analysis run: none (ruff not run; no new code requiring linting beyond small targeted edits)
- Result: 1048 passed, 5 skipped, 0 failed

### Code Insights
- [low] (debt) `orchestrator/tests/test_nodes.py`: The `_CHUNK_PATH` fixture hardcodes `/tmp/WP-001-developer-r0.jsonl` with a Unix path. This technically violates the cross-platform policy (tests should use `tempfile.mkdtemp()` or `tmp_path`), though it is only a string stub value passed to the mock — no real I/O is performed at that path. Safe to defer.
- [low] (improvement) `orchestrator/src/nodes/__init__.py`: The sentinel string `"project"` is a bare string literal. A named module-level constant (e.g. `_PROJECT_WP_SENTINEL = "project"`) would make intent explicit and enable future searches. Deferred as the sentinel is confined to a single local variable within `node_fn`.

### Additional Comments
- No changes were needed to `ChunkWriter` or `_revision.py` — both already handle arbitrary `wp_id` strings.
- The `test_nodes.py` update was necessary because that file had a second test asserting the old `_wp_id`-gate behavior (`test_dialogue_captured_not_emitted_when_wp_id_empty`), independent of `test_streaming_capture.py`.
