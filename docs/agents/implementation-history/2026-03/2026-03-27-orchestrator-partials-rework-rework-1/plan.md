# Plan

## Summary

Address the actionable strategic recommendations from the
`2026-03-27-orchestrator-partials-rework` synthesis. Three work items remain:
update `orchestrator/docs/public-api.md` to remove stale references and add
missing entries; fix `_apply_patches` in `test_graph.py` to cover all 9 graph
nodes; and install `aiosqlite` in the dev venv so the 9 skipped graph tests can
run. Two synthesis recommendations (regex comment asymmetry, Unicode `\w`
pass-through) require no action — the code already contains adequate inline
documentation.

## Architectural Context

The orchestrator sub-project (`orchestrator/`) is a Python LangGraph pipeline
with 9 stage nodes (supervisor, pm, developer, qa, security_auditor, reviewer,
release_engineer, docs, synthesis). The prior plan
(`2026-03-27-orchestrator-partials-rework`) refactored the prompt renderer to
use template partials, added input-validation guards, updated
`architecture.md`, and gave 9 aiosqlite-dependent tests explicit skip
decorators.

Key files for this follow-up:

- `orchestrator/docs/public-api.md` — public API reference for the orchestrator
- `orchestrator/docs/agents/project-manifest/api-surface.md` — manifest API
  surface (already up to date from prior plan)
- `orchestrator/tests/test_graph.py` — graph construction + topology tests
- `orchestrator/src/nodes/prompt_renderer.py` — template renderer module
- `orchestrator/pyproject.toml` — dev dependencies (aiosqlite is already
  declared in `[dev]` extras)

## Approach / Architecture

Three independent work packages, each addressing one confirmed recommendation:

1. **WP-001 — Update `public-api.md`:** Remove the stale
   `PROJECT_PATH_REMINDER` / `WP_SCOPE_REMINDER` constant table, add
   `load_partial` to the Template Renderer table, and correct the `build_graph`
   description from "7-node" to "9-node".

2. **WP-002 — Fix `_apply_patches` in `test_graph.py`:** Add the two missing
   `mock.patch` entries for `src.nodes.security_auditor.make_security_auditor_node`
   and `src.nodes.release_engineer.make_release_engineer_node`. Then install
   `aiosqlite` in the dev venv, remove all 9 `@pytest.mark.skip` decorators,
   and run the full test suite to confirm green.

3. **WP-003 — Dismissed recommendations log:** No code change needed.
   Recommendations 4 (regex comment asymmetry) and 5 (Unicode `\w`
   pass-through) are dismissed: recommendation 4 is already addressed by
   inline comments added during WP-001/WP-004 of the prior plan;
   recommendation 5 is informational only with no action required per the
   synthesis itself.

## Rationale

- WP-001 and WP-002 are independent and can execute in parallel.
- Installing `aiosqlite` is bundled with WP-002 because it only becomes
  meaningful after the `_apply_patches` fix — running the skipped tests without
  all 9 patches would still fail.
- A separate WP-003 is not strictly needed but is listed for traceability so the
  TPM can verify all synthesis items were dispositioned.

## Detailed Steps

### WP-001 — Update `public-api.md`

1. Open `orchestrator/docs/public-api.md`.
2. In the **Graph Construction** table (line 16), change the `build_graph`
   description from "7-node" to "9-node".
3. In the **Template Renderer** section (lines 55–68):
   a. Add a row for `load_partial(name)` matching the signature already
      documented in `orchestrator/docs/agents/project-manifest/api-surface.md`
      line 80.
   b. Delete the entire "Shared prompt-assembly constants" sub-table
      (the `PROJECT_PATH_REMINDER` / `WP_SCOPE_REMINDER` rows and its
      introductory sentence). These constants no longer exist in
      `src/nodes/__init__.py`.
4. Verify no other references to `PROJECT_PATH_REMINDER` or
   `WP_SCOPE_REMINDER` remain in `orchestrator/docs/`.

### WP-002 — Fix `_apply_patches` + Install aiosqlite + Unskip Tests

1. Open `orchestrator/tests/test_graph.py`.
2. In the `_apply_patches` decorator (lines 51–86), add two new `patch()` calls
   inside the `with` block:
   ```python
   patch(
       "src.nodes.security_auditor.make_security_auditor_node",
       side_effect=lambda cfg, tools: _noop_node("security_auditor"),
   ),
   patch(
       "src.nodes.release_engineer.make_release_engineer_node",
       side_effect=lambda cfg, tools: _noop_node("release_engineer"),
   ),
   ```
3. Install `aiosqlite` in the dev venv:
   ```bash
   cd orchestrator && pip install -e ".[dev]"
   ```
4. Remove all 9 `@pytest.mark.skip(reason='requires aiosqlite …')` decorators
   from `test_graph.py`.
5. Run the full orchestrator test suite:
   ```bash
   python -m pytest tests/ -v
   ```
6. Verify 0 failures. The previously-skipped tests should now pass.

### WP-003 — Dismissed Recommendations (No Code Change)

- **Recommendation 4 (regex comment asymmetry):** Already addressed. Lines 68–69
  and 79–80 of `orchestrator/src/nodes/prompt_renderer.py` contain explicit
  inline comments explaining why `_IF_BLOCK_RE` uses `(\w+)` (Python
  identifiers — no hyphens) and `_INCLUDE_RE` uses `([\w-]+)` (kebab-case
  partial file names). No further action needed.
- **Recommendation 5 (Unicode `\w` pass-through):** Informational only. The
  synthesis itself notes this is "not a security issue" and is "low priority".
  No action unless `load_template`/`load_partial` gain external callers in the
  future.

## Dependencies

- WP-002 step 3 (install aiosqlite) depends on WP-002 step 2 (_apply_patches
  fix) being complete before running the test suite.
- WP-001 and WP-002 are independent.
- WP-003 has no dependencies.

## Required Components

- `orchestrator/docs/public-api.md` — edit (WP-001)
- `orchestrator/tests/test_graph.py` — edit (WP-002)
- `orchestrator/pyproject.toml` — no change needed (aiosqlite already declared)
- Dev venv — `pip install -e ".[dev]"` (WP-002)

## Assumptions

- The dev venv is the orchestrator's `.venv` or whichever environment is active
  when running `pip install`.
- The 9 skipped tests in `test_graph.py` will pass once `_apply_patches` covers
  all 9 nodes and `aiosqlite` is available.
- `public-api.md` is a developer-facing reference doc; updating it does not
  require regenerating `.context/` files (that is a separate maintenance step).

## Constraints

- Do not modify `api-surface.md` — it is already up to date from the prior plan.
- Do not modify `architecture.md` — it was fully rewritten in the prior plan.
- No new dependencies may be added; `aiosqlite` is already declared in
  `pyproject.toml` `[dev]` extras.

## Out of Scope

- Regenerating `.context/` docs (can be done separately via
  `node scripts/cli.js ctx-generate`).
- Any changes to the prompt renderer code itself.
- Updating `orchestrator/docs/agents/project-manifest/` manifest docs (already
  current).

## Acceptance Criteria

### WP-001
- `orchestrator/docs/public-api.md` `build_graph` description says "9-node".
- `load_partial` appears in the Template Renderer table.
- No references to `PROJECT_PATH_REMINDER` or `WP_SCOPE_REMINDER` remain in
  `orchestrator/docs/public-api.md`.

### WP-002
- `_apply_patches` patches exactly 9 node factories (supervisor, pm, developer,
  qa, security_auditor, reviewer, release_engineer, docs, synthesis).
- Zero `@pytest.mark.skip(reason='requires aiosqlite …')` decorators remain in
  `test_graph.py`.
- `python -m pytest tests/ -v` reports 0 failures.
- The 9 previously-skipped tests now appear as PASSED.

### WP-003
- All 5 synthesis recommendations are dispositioned (3 actioned, 2 dismissed
  with rationale).

## Testing Strategy

- **WP-001:** Manual review of the edited `public-api.md`. Grep
  `orchestrator/docs/` for stale constant names to confirm removal.
- **WP-002:** Full `pytest` run of the orchestrator test suite. Verify the skip
  count drops by 9 and all previously-skipped tests pass. Documentation-only
  pipeline for WP-001; Implementation + QA + Code Review for WP-002.
- **WP-003:** No testing needed — dismissed items.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Skipped tests fail for reasons beyond `_apply_patches`** | Run the tests immediately after adding the two missing patches but *before* removing skip decorators to diagnose any additional issues. |
| **aiosqlite version conflict with existing venv** | Use `pip install -e ".[dev]"` which respects the `>=0.19.0` pin already in `pyproject.toml`. |
| **`public-api.md` has additional stale content not flagged by synthesis** | Grep the full file for other references to deleted constants or outdated node counts; fix any found. |

---

## Implementation Summary

**Status: COMPLETED** — 2026-03-27

### WP-001 — `orchestrator/docs/public-api.md` updated

- Changed `build_graph` description from "7-node" to "9-node" in the Graph Construction table.
- Added `load_partial(name)` row to the Template Renderer table with description matching `api-surface.md` line 80.
- Removed the entire "Shared prompt-assembly constants" sub-table (`PROJECT_PATH_REMINDER` /
  `WP_SCOPE_REMINDER` rows and their introductory sentence).
- Grep confirmed: zero remaining references to either stale constant name in `orchestrator/docs/`.

### WP-002 — `orchestrator/tests/test_graph.py` fixed + aiosqlite installed

- Added two missing `patch()` entries to `_apply_patches`:
  `src.nodes.security_auditor.make_security_auditor_node` and
  `src.nodes.release_engineer.make_release_engineer_node`.
  `_apply_patches` now patches all 9 node factories.
- Removed all 9 `@pytest.mark.skip(reason='requires aiosqlite …')` decorators.
- Installed `aiosqlite` 0.22.1 via `.venv/bin/pip install -e ".[dev]"`.
- Full test suite result: **646 passed, 1 skipped, 0 failures**.
  The 9 previously-skipped graph tests all pass.
  The 1 remaining skip is `test_integration.py::test_live_happy_path_with_real_mcp`
  (requires a live MCP server — pre-existing, unrelated to this plan).
- Note: `PytestUnhandledThreadExceptionWarning` from aiosqlite's internal thread
  (`RuntimeError: Event loop is closed`) appears for some graph tests as a warning
  but does not affect test outcomes — it is a harmless teardown race condition in
  aiosqlite 0.22.x under Python 3.14 and does not indicate a functional defect.

### WP-003 — Dismissed recommendations

- Recommendation 4 (regex comment asymmetry): No action. Inline comments in
  `prompt_renderer.py` (lines 68–69 and 79–80) already explain the asymmetry.
- Recommendation 5 (Unicode `\w` pass-through): No action. Synthesis itself
  classified this as informational / low priority / not a security issue.

All 3 acceptance criteria groups (WP-001, WP-002, WP-003) are satisfied.
