## Synthesis

### Completion Status
- Date: 2026-07-04
- Status: COMPLETE
- Completed by: Standalone Developer Agent
- Archived in Ledger: 2026-07-04

### Outcome Summary

Implemented `_infer_project_root()` in `orchestrator/src/cli.py` and a matching `checkProjectRoot()` preflight check in the GUI. Inference is strict: a missing `docs/agents/plans/` directory or a shallow plan path is a hard error, not a fallback, ensuring the orchestrator never runs silently against the wrong project root. All tests pass and the MCP server builds clean.

### Implementation Summary

**Initial implementation (plan scope):**
- Added `_infer_project_root(plan_dir: Path) -> Path | None` private helper to `cli.py` after `_derive_ledger_log_dir()`, using the `parents[3]` convention and a `docs/agents/plans/` filesystem sanity check.
- Replaced the single-line `project_path` assignment with a conditional block: `--project-path` takes precedence; otherwise `_infer_project_root()` is called.
- `None` result is a hard CLI error with a descriptive message and `EXIT_ERROR` — no fallback to `config.workspace_root`.
- Added an unconditional `INFO`-level log message when the project root is successfully inferred.
- Updated the `--project-path` argument help text to describe the inference default.
- Added `TestInferProjectRoot` test class in `orchestrator/tests/test_slug_dir.py` covering standard path, sanity-check failure (`None`), shallow path (`None`), and same-project cases.

**Post-plan refinements:**
- Removed the `fallback: Path` parameter from `_infer_project_root()` entirely — the function now returns `Path | None`. Failure cases that previously returned a fallback now return `None`, and the call site exits with a clear error message. Tests renamed from `_returns_fallback` to `_returns_none` accordingly.
- Added `checkProjectRoot(resolvedPlan: string): Promise<PreflightResult>` to `mcp-server/gui/orchestrator-manager.ts`, mirroring the Python logic (4-level walk + `stat` sanity check). Wired into the `planChecks` parallel group in `startOrchestrator()`, blocking GUI launch if the check fails.
- Updated the `orchestrator-manager.ts` module doc comment (7 → 8 preflight checks).

### Documentation Updates
- `orchestrator/docs/agents/project-manifest/api-surface.md` — Added `_infer_project_root` row to the CLI private helpers table; updated signature from `(plan_dir, fallback) -> Path` to `(plan_dir) -> Path | None` and revised description to reflect the hard-error semantics.

### Verification Summary
- Tests run: `orchestrator/tests/test_slug_dir.py` (22 tests), full orchestrator suite excluding `test_cli.py` (989 tests)
- Build run: `mcp-server npm run build` (tsc) — clean
- Static analysis run: `ruff check src/cli.py tests/test_slug_dir.py` — one import-sort issue auto-fixed
- Result: All tests pass; no type errors; no ruff violations

### Code Insights
- [low] (debt) `orchestrator/tests/test_slug_dir.py`: The module-level constants `WORKSPACE` and `LEDGER_BASE` are defined as Unix-style absolute paths (`/workspaces/ai-insights`). These work on all platforms because they are not used in `is_dir()` checks (only in `Path` equality assertions), but they are implicitly Unix-only in their literal form. Future contributors could use `tmp_path`-style fixtures to make the intent clearer.
- [low] (improvement) `orchestrator/src/cli.py` — `_infer_project_root`: The `parents[3]` index is magic. A named constant (e.g. `_PLAN_DIR_DEPTH = 3`) with a docstring reference to the `<root>/docs/agents/plans/<slug>` convention could make the intent more explicit, consistent with how `_derive_repo_name` documents the same pattern in its docstring.
- [low] (convention) `mcp-server/gui/orchestrator-manager.ts` — `checkProjectRoot`: The 4-level walk is implemented as a manual `for` loop rather than using `dirname` chained 4 times or indexing into `resolvedPlan.split(path.sep)`. Either alternative would be more idiomatic in the TypeScript style used elsewhere in the file; the loop is correct but slightly verbose.

### Additional Comments
- The `test_cli.py` suite was excluded from the broad test run because it contains integration tests that require external process setup (MCP server, network, etc.) and is typically run separately. The targeted `test_slug_dir.py` suite covers all new and existing unit tests for the helpers introduced by this plan.
- The GUI `checkProjectRoot` check has no dedicated unit tests; it is covered by the existing GUI integration test surface and mirrors logic already unit-tested on the Python side.
