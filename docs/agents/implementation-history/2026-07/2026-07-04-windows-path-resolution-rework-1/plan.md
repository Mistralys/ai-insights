# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context
The repository has no strategic vision document. Prior orchestrator projects include `2026-03-22-orchestrator-progress-reporting` and `2026-07-03-pm-dialogue-capture`. The latter touched `_derive_slug_dir` and `create_stage_node()` in `orchestrator/src/nodes/__init__.py` — the same module area affected by this plan. A global insight on Windows path handling (reserved device names) confirms Windows cross-platform issues are a recurring concern in this codebase.

## Summary
This plan addresses the remaining unfixed issue from the `2026-07-04-windows-path-resolution` research paper: when the orchestrator runs a plan from an external project (e.g., `ai-insights-dev/docs/agents/plans/…`), the `target_project_path` incorrectly resolves to the AI Insights workspace root (where the orchestrator lives) instead of the target project's root. The synthesis from the original plan fixed the Windows `virtual_mode` issue but did not address this cross-project path inference bug.

## Architectural Context
- **`orchestrator/src/cli.py`** — CLI entry point. Line 690 computes `project_path` as either `--project-path` argument or `config.workspace_root` (the ai-insights workspace root, derived from `_ORCHESTRATOR_ROOT.parent` in [config.py](orchestrator/src/config.py)).
- **`orchestrator/src/state.py`** — Defines `WorkflowState` TypedDict. `target_project_path` is documented as "Absolute path to the *codebase* being worked on."
- **`orchestrator/src/nodes/__init__.py`** — `create_stage_node()` reads `state["target_project_path"]` (line 852) and passes it as `root_dir` to `LocalShellBackend` (line 865). Also contains `_derive_slug_dir()` and `_derive_repo_name()` which already use the `plan_dir.parents[3]` convention.
- **`orchestrator/src/cli.py:105-128`** — `_derive_repo_name()` already infers the repo name from `plan_dir.parents[3].name`, confirming the `<project-root>/docs/agents/plans/<slug>` convention is well-established.
- **Plan path convention:** Plans live at `<project-root>/docs/agents/plans/<slug>/plan.md`. The plan directory (`plan_dir`) is therefore at depth 4 below the project root: `plan_dir.parents[3]` yields the project root.

## Approach / Architecture
Replace the fallback logic on line 690 of `cli.py` so that when `--project-path` is not provided, the orchestrator infers the target project root from the plan path using the established `parents[3]` convention (Option A from the research paper). Include a sanity check that the inferred root contains `docs/agents/plans/` to prevent incorrect inference for shallow paths. Fall back to `config.workspace_root` when inference fails.

Extract the inference logic into a private helper function `_infer_project_root()` for testability and to match the existing pattern of small private helpers (`_derive_repo_name`, `_derive_ledger_log_dir`).

Additionally, emit an `INFO`-level log message when the project root is inferred (vs. explicitly provided), so cross-project runs are observable in logs.

### Post-Implementation Amendments

During implementation, the approach was refined in two significant ways (see `synthesis.md` for full details):

1. **Hard-error semantics instead of silent fallback.** The `_infer_project_root()` signature was changed from `(plan_dir: Path, fallback: Path) -> Path` to `(plan_dir: Path) -> Path | None`. When inference fails (shallow path or sanity-check failure), the function returns `None` and the CLI exits with a descriptive error message and `EXIT_ERROR` — it does not silently fall back to `config.workspace_root`. This is stricter than the plan specified, but prevents the orchestrator from ever running silently against the wrong project root.

2. **GUI preflight check.** A matching `checkProjectRoot(resolvedPlan: string): Promise<PreflightResult>` was added to `mcp-server/gui/orchestrator-manager.ts`, mirroring the Python `parents[3]` + sanity-check logic. It is wired into the `planChecks` parallel group in `startOrchestrator()`, blocking GUI-initiated runs when the check fails.

## Rationale
The `parents[3]` convention is already used by `_derive_repo_name()` and `_derive_slug_dir()` throughout the orchestrator. Reusing it for `target_project_path` inference is consistent and avoids introducing a new convention. The sanity check (`docs/agents/plans` directory exists at the inferred root) prevents false positives for plans at non-standard depths without requiring the user to always supply `--project-path`.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Infer project root from plan path | `_infer_project_root()` with `parents[3]` + sanity check + fallback | (B) Require `--project-path` for external plans — reject if plan is outside workspace root | Option B is explicit but breaks existing cross-project workflows and adds cognitive load; Option A is automatic, uses an already-established convention, and falls back safely |
| Extract to helper function | `_infer_project_root(plan_dir)` returning `Path` | Inline the logic at the call site | A helper is testable in isolation and matches the existing `_derive_repo_name` / `_derive_ledger_log_dir` pattern |

## Pattern Alignment
- **`parents[3]` convention** — follows `_derive_repo_name()` at [cli.py](orchestrator/src/cli.py) line 105 and `_derive_slug_dir()` at [nodes/__init__.py](orchestrator/src/nodes/__init__.py) line 147.
- **Private helper extraction** — follows the pattern of `_derive_repo_name()` and `_derive_ledger_log_dir()` in [cli.py](orchestrator/src/cli.py).
- **Fallback to `config.workspace_root`** — preserves backward compatibility for same-project plans and non-standard plan locations.

## Detailed Steps

### Step 1: Add `_infer_project_root()` helper to `cli.py`
Add a new private function `_infer_project_root(plan_dir: Path, fallback: Path) -> Path` near the existing `_derive_repo_name()` function (after line 128). The function:
1. Computes `inferred_root = plan_dir.parents[3]`.
2. Checks that `(inferred_root / "docs" / "agents" / "plans").is_dir()` returns `True`.
3. Returns `inferred_root` if the sanity check passes; otherwise returns `fallback`.
4. Catches `IndexError` (path too shallow) and returns `fallback`.

### Step 2: Replace `project_path` assignment on line 690
Change:
```python
project_path = Path(args.project_path).resolve() if args.project_path else config.workspace_root
```
To:
```python
if args.project_path:
    project_path = Path(args.project_path).resolve()
else:
    project_path = _infer_project_root(plan_dir, config.workspace_root)
```

### Step 3: Add an info-level log message when project root is inferred
After the `project_path` assignment, add a log line when `--project-path` was not provided and the inferred root differs from `config.workspace_root`:
```python
if not args.project_path and project_path != config.workspace_root:
    log.info("Inferred target project root from plan path: %s", project_path)
```

### Step 4: Update `--project-path` help text
Update the argument help text (line 240) to reflect the new inference default:
```python
help=(
    "Override the target project/codebase path. "
    "Defaults to the project root inferred from the plan directory "
    "(4 levels up from the plan slug directory)."
),
```

### Step 5: Add unit tests for `_infer_project_root()`
Add a new test class in `orchestrator/tests/test_slug_dir.py` (which already tests the related `_derive_slug_dir` and `_derive_ledger_log_dir` helpers). Tests:
1. **Standard plan path** — returns the inferred project root when `docs/agents/plans/` exists at the expected location.
2. **Sanity check fails** — returns the fallback when the inferred root does not contain `docs/agents/plans/`.
3. **Shallow path** — returns the fallback when the plan directory has fewer than 4 ancestors.
4. **Same-project path** — returns the workspace root when the plan is inside the workspace root (backward compatibility).

### Step 6: Update the orchestrator project manifest
Update `orchestrator/docs/agents/project-manifest/api-surface.md` to document the new `_infer_project_root()` function in the private helpers table.

## Dependencies
- None. This is a self-contained change within the orchestrator sub-project.

## Required Components
- `orchestrator/src/cli.py` — new helper + modified `project_path` assignment + updated help text
- `orchestrator/tests/test_slug_dir.py` — new test class for `_infer_project_root()`
- `orchestrator/docs/agents/project-manifest/api-surface.md` — document new helper
- `mcp-server/gui/orchestrator-manager.ts` — GUI preflight check (post-plan addition; see synthesis)

## Assumptions
- The `<project-root>/docs/agents/plans/<slug>/plan.md` convention is stable and enforced by the plan creation workflow and IDE-based planning agents.
- The `docs/agents/plans/` directory always exists at the project root for any project that uses the orchestrator.
- `plan_dir` is always the resolved absolute path to the slug directory by the time it reaches line 690 (ensured by the preceding `plan_path.parent` logic).

## Constraints
- Must not break same-project plans (the common case where the plan is inside the ai-insights workspace itself).
- Must work on Windows, macOS, and Linux (cross-platform policy).
- Must never run silently against the wrong project root. (Amended: the implementation treats inference failure as a hard error rather than falling back — see Post-Implementation Amendments.)

## Out of Scope
- Upgrading `deepagents` from 0.4.5 to 0.6.12+ (noted as medium-term follow-up in the research paper).
- Filing an upstream issue with `langchain-ai/deepagents` about the `validate_path` / `_resolve_path` incompatibility.
- The `virtual_mode=True` fix — already applied by the original plan's synthesis.

## Acceptance Criteria
- When the orchestrator runs a plan from an external project without `--project-path`, `target_project_path` resolves to the external project's root (not the ai-insights workspace root).
- When the orchestrator runs a same-project plan without `--project-path`, `target_project_path` resolves to the ai-insights workspace root (backward compatible).
- When `--project-path` is explicitly provided, it takes precedence over inference (existing behaviour preserved).
- When the plan path is too shallow for inference or the sanity check fails, the CLI exits with a descriptive error (amended from fallback — see Post-Implementation Amendments).
- An info-level log message is emitted when the project root is inferred from the plan path and differs from the workspace root.
- All existing orchestrator tests pass.
- New unit tests cover `_infer_project_root()` for standard, shallow, and sanity-check-failure cases.

## Testing Strategy
Unit tests for the `_infer_project_root()` helper using `tmp_path` fixtures to create directory structures with and without the `docs/agents/plans/` sanity-check directory. No integration tests needed — the function is pure path logic with a single `is_dir()` filesystem check, matching the testing approach already used for `_derive_slug_dir()` and `_derive_ledger_log_dir()`.

## Test Plan

- `orchestrator/tests/test_slug_dir.py::TestInferProjectRoot::test_standard_plan_path_returns_inferred_root` — Given a plan dir at `<root>/docs/agents/plans/<slug>` where `<root>/docs/agents/plans/` exists on disk, returns `<root>`. Covers acceptance criterion: external project root inference.
- `orchestrator/tests/test_slug_dir.py::TestInferProjectRoot::test_sanity_check_fails_returns_fallback` — Given a plan dir at `<root>/docs/agents/plans/<slug>` where `<root>/docs/agents/plans/` does NOT exist on disk, returns the fallback path. Covers acceptance criterion: sanity check failure fallback.
- `orchestrator/tests/test_slug_dir.py::TestInferProjectRoot::test_shallow_path_returns_fallback` — Given a plan dir with fewer than 4 ancestors (e.g., `/a/b/slug`), returns the fallback. Covers acceptance criterion: shallow path fallback.
- `orchestrator/tests/test_slug_dir.py::TestInferProjectRoot::test_same_project_returns_workspace_root` — Given a plan dir inside the workspace root where `docs/agents/plans/` exists, the inferred root matches the workspace root. Covers acceptance criterion: backward compatibility.

## Documentation Updates

- `orchestrator/docs/agents/project-manifest/api-surface.md` — Add `_infer_project_root` to the private helpers table with signature `(plan_dir: Path) -> Path | None` and description (amended from `(plan_dir: Path, fallback: Path) -> Path` — see Post-Implementation Amendments).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Non-standard plan location** causes incorrect inference | Sanity check (`docs/agents/plans/` must exist at inferred root) prevents false positives; falls back to `config.workspace_root` |
| **Symlinked plan directories** resolve to unexpected ancestors | `plan_dir` is already resolved (via `plan_path.parent` after `plan_path.exists()` check); `parents[3]` operates on the resolved path |
| **Regression for same-project plans** | Explicit test case verifies backward compatibility; inference returns the same value as `config.workspace_root` for same-project plans |
