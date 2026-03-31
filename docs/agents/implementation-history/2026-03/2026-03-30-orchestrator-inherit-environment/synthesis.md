## Synthesis

### Completion Status
- Status: COMPLETE
- Completed by: Standalone Developer Agent

### Implementation Summary
- Added `inherit_env=True` to the `LocalShellBackend` constructor call in
  `orchestrator/src/nodes/__init__.py`, enabling agent subprocesses to access
  host CLI tools (`python`, `npm`, `git`, etc.) via the inherited `$PATH`.
- Added an inline security-decision comment at the call site documenting the
  trade-off (all host env vars exposed to subprocesses) and pointing to the
  deferred-topics document for the planned curated-env hardening.
- Added a focused unit test `TestLocalShellBackendInheritEnv::test_stage_node_passes_inherit_env_true`
  that asserts `LocalShellBackend` is called with `inherit_env=True` when a
  stage node is invoked via `create_stage_node`.

### Documentation Updates
- `orchestrator/docs/architecture.md` — updated step 5 of the Stage Nodes
  lifecycle to reflect `LocalShellBackend(root_dir=target_project_path, inherit_env=True)`.
- `docs/agents/deferred-topics.md` — created new workspace-wide living document
  tracking deliberately deferred implementation decisions. Added the first entry
  under `## Orchestrator`: curated environment injection (Pattern 2), with
  trigger condition, target state, and reference to the research paper.

### Verification Summary
- Tests run: `orchestrator/tests/test_nodes.py` (full suite — 133 tests)
- Static analysis run: n/a (no linter configured for orchestrator; ruff is a dev
  dependency but not invoked as part of this plan)
- Result: 132 passed, 1 pre-existing failure
  (`TestSlimPromptContent::test_pm_prompt_has_slim_fields` — confirmed failing
  before these changes via `git stash` verification; unrelated to `inherit_env`).
  New test `TestLocalShellBackendInheritEnv::test_stage_node_passes_inherit_env_true`
  passes.

### Code Insights
- [low] (debt) `orchestrator/tests/test_nodes.py`: `TestSlimPromptContent::test_pm_prompt_has_slim_fields` is a pre-existing failing test — the PM prompt (`_build_pm_prompt`) does not inject `project_path` into the prompt text, so the assertion `assert str(tmp_path) in prompt` fails. Either the test expectation is ahead of the implementation, or the implementation was inadvertently regressed. Suggesting a focused fix pass for the PM prompt builder.
- [low] (improvement) `orchestrator/docs/architecture.md`: The `.context/orchestrator/documentation.md` generated context file still references the old `LocalShellBackend(root_dir=target_project_path)` wording. The next `node scripts/cli.js ctx-generate` run will pick up the corrected `architecture.md` and regenerate the snapshot automatically — no manual action required.

### Additional Comments
- The pre-existing test failure (`test_pm_prompt_has_slim_fields`) is out of
  scope for this plan. It is documented above as a code insight and should be
  addressed in a separate work item.
- The `.context/` snapshot files are auto-generated and gitignored; they will
  reflect the `architecture.md` change on the next regeneration.
