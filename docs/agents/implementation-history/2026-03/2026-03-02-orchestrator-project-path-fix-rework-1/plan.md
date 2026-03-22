# Plan

## Summary

Address all four actionable technical debt items identified in the synthesis of `2026-03-02-orchestrator-project-path-fix`, plus perform a live orchestration smoke test. The changes are confined to three files: `orchestrator/src/supervisor.py`, `orchestrator/tests/test_nodes.py`, and `orchestrator/tests/test_supervisor.py`. No new files are required and no public interfaces change.

---

## Architectural Context

The orchestrator (`orchestrator/src/`) is a LangGraph + Deep Agents pipeline executor. The relevant files are:

- **`orchestrator/src/supervisor.py`** — Routing brain; queries `ledger_get_next_action` per agent role (priority order: PM → Developer → QA → Reviewer → Documentation) and dispatches nodes. The dispatch vocabulary is expressed via two module-level frozensets: `_SKIP_ACTIONS` (line 44) and `_DISPATCH_ACTIONS` (line 56). The role iteration list `_ROLES` lives inside `_route` at line 305 and has no explanatory comment.
- **`orchestrator/tests/test_nodes.py`** — `TestToolWrappingInNode` class; `test_wrapped_tools_injects_project_path_into_calls` (line 453) uses `MagicMock()` as a tool stub, which causes a false-positive `hasattr(wrapped_tool, "_orig_ainvoke")` assertion because `MagicMock` auto-creates any attribute on lookup. A plain `_TrackingTool` class is already defined lower in the same test class (line 511) and should be the pattern here.
- **`orchestrator/tests/test_supervisor.py`** — `_derive_next_action` helper (line 35) is a ~100-line re-implementation of MCP routing logic used by test mocks; it has no warning that it must be kept in sync with the MCP server's action vocabulary.

---

## Approach / Architecture

Four surgical code edits and one validation run:

1. **Remove dead `REWORK_QA`** from the `_DISPATCH_ACTIONS` frozenset in `supervisor.py` (the MCP server no longer emits this action; keeping it silently misleads future maintainers).
2. **Add priority-order comment** above `_ROLES` in `supervisor.py` explaining the "first match wins" dispatch semantics.
3. **Fix false-positive sentinel assertion** in `test_nodes.py` by replacing the `MagicMock()` tool stub with a plain `_TrackingTool` class (same pattern already used in sibling tests in that class).
4. **Add drift-risk docstring annotation** to `_derive_next_action` in `test_supervisor.py`.
5. **Run the full test suite** after the edits to confirm 216/216 passing; then run the live smoke test script.

---

## Rationale

All four debt items were flagged as "Low" priority but are clarity/correctness concerns that compound over time:
- Dead entries in `_DISPATCH_ACTIONS` will mislead future contributors into believing `REWORK_QA` is a reachable runtime path.
- `_ROLES` without a priority comment is an implicit contract — the regression test `test_first_dispatchable_role_wins` encodes it, but the source is silent.
- The `MagicMock`-based sentinel assertion is a false positive that gives false confidence; any breakage in the real wrapping logic would go undetected by that assertion.
- `_derive_next_action` drift is a latent maintenance trap; a one-line docstring note is the minimum viable safeguard.

---

## Detailed Steps

1. **Edit `orchestrator/src/supervisor.py` — remove `REWORK_QA`**
   - In the `_DISPATCH_ACTIONS` frozenset (around line 63), remove the string `"REWORK_QA"` from the `# QA` line. The remaining QA entry `"RUN_QA"` is still valid.

2. **Edit `orchestrator/src/supervisor.py` — add `_ROLES` comment**
   - Directly above the `_ROLES = [` definition (around line 305), add a comment explaining that roles are queried in priority order and the first role returning a dispatchable action wins.

3. **Edit `orchestrator/tests/test_nodes.py` — fix false-positive sentinel test**
   - In `test_wrapped_tools_injects_project_path_into_calls` (line 453), replace the `MagicMock()` tool stub (`real_tool = MagicMock()`) with a plain inline `_TrackingTool` class that has a real `ainvoke` coroutine. This ensures `hasattr(wrapped_tool, "_orig_ainvoke")` only passes after `inject_project_path` has genuinely stored the sentinel. The `AsyncMock(side_effect=_tracking_ainvoke)` plumbing should be transferred to the plain class's `ainvoke` method. A class docstring should state the reason for avoiding `MagicMock`.

4. **Edit `orchestrator/tests/test_supervisor.py` — annotate `_derive_next_action`**
   - Append a **Drift risk** paragraph to the existing docstring of `_derive_next_action` (line 35–42) warning that this helper re-implements MCP routing logic and must be manually updated whenever the MCP server's action vocabulary changes.

5. **Verify tests**
   - Run `orchestrator/.venv/bin/pytest tests/ -q` and confirm 216 passed, 0 failed.

6. **Live smoke test**
   - Run a minimal orchestrator invocation against a test ledger plan (`orchestrator/src/cli.py`) to validate that injection, prompt reinforcement, and supervisor routing all cooperate in a real run.

---

## Dependencies

- No new packages required.
- Steps 1–4 are fully independent and can be executed in parallel.
- Step 5 depends on steps 1–4 being complete.
- Step 6 depends on step 5 passing.

---

## Required Components

- `orchestrator/src/supervisor.py` — edit (steps 1, 2)
- `orchestrator/tests/test_nodes.py` — edit (step 3)
- `orchestrator/tests/test_supervisor.py` — edit (step 4)

No new files.

---

## Assumptions

- The MCP server does not and will not emit `REWORK_QA` in the current action vocabulary (confirmed by synthesis).
- The `_TrackingTool` replacement for `test_wrapped_tools_injects_project_path_into_calls` should follow the same pattern already established by `_TrackingTool` in the sibling test `test_wrapped_tools_inject_project_path_on_invocation` (line 511), i.e., a local inner class with a real `async def ainvoke`.
- The live smoke test (step 6) uses the existing test ledger infrastructure; a plan document is already available in `mcp-server/storage/ledger/`.

---

## Constraints

- Do not introduce new public API surfaces or change existing method signatures.
- Do not modify generated persona files.
- Do not add new test files; all changes are in-place edits of existing test files.

---

## Out of Scope

- Any MCP server changes.
- Adding `REWORK_QA` back under a different name (not planned).
- Refactoring `_derive_next_action` beyond adding the docstring annotation.
- Changes to node prompt builders or the injection layer.

---

## Acceptance Criteria

- `"REWORK_QA"` does not appear in `_DISPATCH_ACTIONS` in `supervisor.py`.
- `_ROLES` in `supervisor.py` has an adjacent comment explaining priority-order dispatch semantics.
- `test_wrapped_tools_injects_project_path_into_calls` in `test_nodes.py` uses a plain class (not `MagicMock`) as the tool stub, and the `hasattr(_orig_ainvoke)` assertion only passes because `inject_project_path` actually stored the sentinel.
- `_derive_next_action` docstring in `test_supervisor.py` contains an explicit drift-risk warning referencing MCP server action vocabulary.
- `orchestrator/.venv/bin/pytest tests/ -q` reports **216 passed, 0 failed** after all edits.
- Live smoke test completes without `project_path` missing-parameter errors.

---

## Testing Strategy

- Re-run the full pytest suite after each edit batch; interpret any regression as a sign the edit broke an assumption.
- For step 3, verify the new plain-class assertion fails without `inject_project_path` being called (i.e., the test actually detects the absence of the sentinel).

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Removing `REWORK_QA` causes a test to fail** | Grep test files for `REWORK_QA` before editing; update any test that references it. |
| **Plain-class `_TrackingTool` replacement changes test semantics** | Keep the `seen_inputs` capture pattern intact; only change the tool stub type. |
| **Live smoke test environment missing `.env` / ledger plan** | Use existing `mcp-server/storage/ledger/` entries; confirm `MCP_SERVER_CMD` in `orchestrator/.env`. |
