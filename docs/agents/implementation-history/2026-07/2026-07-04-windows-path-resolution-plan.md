# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary
Fix the Windows path resolution bug in the orchestrator's `LocalShellBackend` instantiation. The `deepagents` library (v0.4.5) has two interacting bugs on Windows: `validate_path()` rejects Windows drive-letter paths, and `_resolve_path()` mis-joins root-anchored POSIX paths against the CWD (pathlib replaces everything after the drive letter). Setting `virtual_mode=True` on `LocalShellBackend` resolves paths as `root_dir`-relative, which works correctly on all platforms.

## Architectural Context
- `orchestrator/src/nodes/__init__.py` — `create_stage_node()` instantiates `LocalShellBackend` with `root_dir=target_path` and `inherit_env=True`. This is the shell backend used by all agent stages.
- `deepagents/backends/utils.py` — `validate_path()` rejects paths matching `^[a-zA-Z]:` with "Windows absolute paths are not supported".
- `deepagents/backends/filesystem.py` — `_resolve_path()` in non-virtual mode uses `Path.is_absolute()` which behaves differently on Windows for root-anchored POSIX paths (e.g., `/docs/file.md`).

## Approach / Architecture
Add `virtual_mode=True` to the existing `LocalShellBackend` constructor call. Virtual mode uses correct path joining (`(self.cwd / vpath.lstrip("/")).resolve()`) that strips leading `/` before joining, avoiding the Windows pathlib drive-letter replacement issue.

## Rationale
This is the smallest change that fixes the bug on all platforms. Virtual mode is the correct operating mode for the orchestrator's use case (all agent file operations should be relative to the target project root).

## Detailed Steps
1. Change `LocalShellBackend(root_dir=target_path or None, inherit_env=True)` to `LocalShellBackend(root_dir=target_path or None, virtual_mode=True, inherit_env=True)` in `orchestrator/src/nodes/__init__.py`.
2. Add an inline comment explaining the rationale and referencing the research document.

## Dependencies
- None.

## Required Components
- `orchestrator/src/nodes/__init__.py` — single constructor call change

## Assumptions
- `virtual_mode=True` is a supported and stable parameter of `LocalShellBackend` in deepagents 0.4.5.

## Constraints
- Must work on Windows, macOS, and Linux.

## Out of Scope
- Upgrading `deepagents` from 0.4.5 to 0.6.12+.
- Filing an upstream issue with `langchain-ai/deepagents`.
- Cross-project `target_project_path` inference (addressed in rework-1).

## Acceptance Criteria
- `LocalShellBackend` is instantiated with `virtual_mode=True`.
- All existing orchestrator tests pass.

## Testing Strategy
Run the full orchestrator pytest suite to confirm no regressions.

## Test Plan
- No new tests required — this is a single-parameter addition to an existing constructor call. Verified by the existing test suite (1048 passed, 5 skipped, 0 failures).

## Documentation Updates
- None required. The research document `docs/agents/research/2026-07-04-windows-path-resolution.md` provides the full analysis and is referenced in the inline comment.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`virtual_mode` changes path semantics for existing agent operations** | Virtual mode resolves all paths relative to `root_dir`, which is already the intended semantic for agent file operations |
