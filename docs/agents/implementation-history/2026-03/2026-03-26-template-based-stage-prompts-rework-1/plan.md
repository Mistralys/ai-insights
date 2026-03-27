# Plan — Template-Based Stage Prompts: Post-Project Rework

## Summary

Address all actionable items from the synthesis of the template-based stage
prompts project. Five concrete tasks: consolidate duplicate test coverage into
a single file, install the missing `aiosqlite` dependency to clear 9
pre-existing test failures, add `extra` guard consistency to 4 WP-scoped node
modules, clean up temporary QA verification scripts, and add a `.gitignore`
entry to prevent future QA artifacts from being tracked.

## Architectural Context

The orchestrator (`orchestrator/`) is a Python 3.11+ LangGraph pipeline. The
recent template-based stage prompt migration introduced:

- `orchestrator/src/nodes/prompt_renderer.py` — template renderer with
  `load_template()`, `render_prompt()`, `clear_template_cache()`.
- `orchestrator/src/nodes/templates/` — 8 Markdown templates + `VARIABLES.md`.
- 8 migrated node modules in `orchestrator/src/nodes/` — each calling
  `render_prompt()` instead of the removed `build_stage_prompt()`.

Test files:
- `orchestrator/tests/test_prompt_renderer.py` — 36 dedicated renderer tests.
- `orchestrator/tests/test_nodes.py` — 14 renderer tests (classes
  `TestRenderPrompt` at line 1580 and `TestLoadTemplate` at line 1682) that
  duplicate coverage from `test_prompt_renderer.py`.
- `orchestrator/tests/test_graph.py` — 9 failures caused by
  `ModuleNotFoundError: No module named 'aiosqlite'`.

Temporary artifacts in `orchestrator/` root:
- `_qa_verify.py`, `_qa_verify_wp001.py`, `_qa_verify_wp001_v3.py`,
  `_qa_verify_wp001_v4.py`, `_qa_verify_wp002.py`, `_qa_verify_wp003.py`,
  `_qa_verify_wp004.py`, `_qa_verify_wp005.py` (8 files).

## Approach / Architecture

1. **Test consolidation** — Remove the `TestRenderPrompt` and
   `TestLoadTemplate` classes from `test_nodes.py`. The canonical renderer
   tests live in `test_prompt_renderer.py` (which already covers all the
   same scenarios plus more). No tests are lost; maintenance surface shrinks.

2. **aiosqlite installation** — Install `aiosqlite` in the orchestrator's
   virtual environment (it is already declared in `pyproject.toml` as a core
   dependency). Verify the 9 `test_graph.py` failures resolve to 0.

3. **Extra guard consistency** — In `developer.py`, `qa.py`, `reviewer.py`,
   and `docs.py`, wrap the `extra` string construction in an
   `if wp_id else ""` guard identical to the `wp_scope_reminder` pattern
   already in place. This makes the "no wp_id → no extra" invariant explicit
   and consistent across all 4 modules.

4. **QA artifact cleanup** — Delete the 8 `_qa_verify*.py` files from
   `orchestrator/` and add `_qa_verify*.py` to `orchestrator/.gitignore` to
   prevent future QA scripts from being tracked.

## Rationale

- Duplicate tests increase maintenance cost: when renderer behaviour changes,
  two files must be updated. Consolidation into the dedicated file is the
  standard pattern.
- `aiosqlite` is a declared dependency that simply was never installed in the
  local dev environment. Fixing this restores a clean 0-failure baseline.
- The `extra` guard is a defensive consistency fix. While `wp_id` is never
  empty for WP-scoped nodes in practice, the explicit guard matches the
  existing `wp_scope_reminder` pattern and prevents malformed prompts if the
  invariant is ever violated.
- QA verification scripts are session artifacts, not part of the codebase.

## Detailed Steps

### Step 1 — Consolidate duplicate renderer tests

1. Open `orchestrator/tests/test_nodes.py`.
2. Remove the `TestRenderPrompt` class (starts at line 1580) and the
   `TestLoadTemplate` class (starts at line 1682), including their section
   comment headers (`# Tests: render_prompt (WP-006)` and
   `# Tests: load_template (WP-006)`).
3. Remove the now-unused `clear_template_cache`, `load_template`,
   `render_prompt` imports from the top-level imports if they are no longer
   referenced elsewhere in the file. Verify by searching the remaining file
   for usages of these three names before removing the import line.
4. Run `python3 -m pytest tests/test_prompt_renderer.py -v` to confirm the
   canonical suite still passes.
5. Run `python3 -m pytest tests/test_nodes.py -v` to confirm no other tests
   broke from the removal.

### Step 2 — Install aiosqlite and clear test failures

1. Activate the orchestrator's virtual environment.
2. Run `pip install aiosqlite` (or `pip install -e '.[dev]'` to refresh all).
3. Run `python3 -m pytest tests/test_graph.py -v` and verify 0 failures.
4. Run the full test suite `python3 -m pytest` and confirm the global failure
   count drops from 9 to 0.

### Step 3 — Add extra guard consistency

In each of the 4 files (`developer.py`, `qa.py`, `reviewer.py`, `docs.py`),
change the `extra` construction inside the `_build_*_prompt()` function to be
guarded by `if wp_id`:

**Before** (pattern in all 4 files):
```python
extra = (
    f"**SCOPE RESTRICTION — …{wp_id}…"
    "Do NOT call any MCP tool with a different work_package_id.**"
)
```

**After:**
```python
extra = (
    f"**SCOPE RESTRICTION — …{wp_id}…"
    "Do NOT call any MCP tool with a different work_package_id.**"
) if wp_id else ""
```

For `developer.py` specifically, the `extra` block is longer (includes the
`ledger_begin_work` instruction); the same `if wp_id else ""` guard applies
to the entire multi-line expression.

Run `python3 -m pytest tests/test_nodes.py -v` after the change to verify no
regressions.

### Step 4 — Clean up QA verification scripts

1. Delete all 8 files:
   - `orchestrator/_qa_verify.py`
   - `orchestrator/_qa_verify_wp001.py`
   - `orchestrator/_qa_verify_wp001_v3.py`
   - `orchestrator/_qa_verify_wp001_v4.py`
   - `orchestrator/_qa_verify_wp002.py`
   - `orchestrator/_qa_verify_wp003.py`
   - `orchestrator/_qa_verify_wp004.py`
   - `orchestrator/_qa_verify_wp005.py`

### Step 5 — Add .gitignore entry for QA artifacts

1. Open `orchestrator/.gitignore`.
2. Add `_qa_verify*.py` on a new line.
3. Also add `_verify*.py` to catch the 2 additional temporary verify scripts
   (`_verify_wp002.py`, `_verify_wp003.py`) and the `_test_config.py` file
   pattern. Actually, check which `_*.py` files exist and determine the
   minimal ignore pattern. The files are:
   - `_qa_verify*.py` (8 files)
   - `_verify_wp002.py`, `_verify_wp003.py`
   - `_test_config.py`
   All follow the `_*.py` prefix convention for temporary scripts. Add
   `_*.py` as the gitignore entry to catch all temporary underscore-prefixed
   Python scripts.

## Dependencies

- Step 1 has no dependencies.
- Step 2 has no dependencies.
- Step 3 has no dependencies.
- Step 4 has no dependencies.
- Step 5 depends on step 4 (verify files are gone before adding ignore).
- Steps 1–4 can be parallelized.

## Required Components

- `orchestrator/tests/test_nodes.py` — edit (remove 2 test classes)
- `orchestrator/tests/test_prompt_renderer.py` — no change (already complete)
- `orchestrator/src/nodes/developer.py` — edit (extra guard)
- `orchestrator/src/nodes/qa.py` — edit (extra guard)
- `orchestrator/src/nodes/reviewer.py` — edit (extra guard)
- `orchestrator/src/nodes/docs.py` — edit (extra guard)
- `orchestrator/.gitignore` — edit (add `_*.py`)
- 8 `_qa_verify*.py` files — delete
- 2 `_verify_wp*.py` files — delete
- 1 `_test_config.py` file — delete

## Assumptions

- `test_prompt_renderer.py` already covers every scenario tested by the
  duplicate classes in `test_nodes.py` (verified by code review).
- The 9 `test_graph.py` failures are exclusively caused by the missing
  `aiosqlite` package (confirmed by error output).
- `wp_id` is never empty for WP-scoped nodes in production, so the `extra`
  guard is a defensive consistency improvement, not a bug fix.
- All `_*.py` files in the orchestrator root are temporary artifacts, not
  production code that should be tracked.

## Constraints

- Do not modify the `test_prompt_renderer.py` file — it is already complete.
- Do not change template file content or renderer behaviour.
- The `_*.py` gitignore must not interfere with `__init__.py` or other
  legitimate underscore-prefixed Python files in subdirectories (gitignore
  pattern `_*.py` at the root of `orchestrator/` only affects top-level
  files, which is the correct scope since `.gitignore` is in `orchestrator/`).

## Out of Scope

- Template deduplication (base template + per-stage overrides) — requires
  renderer architecture changes, explicitly deferred in synthesis.
- Persona/prompt review cycle as part of standard release process — process
  decision, not a code change.
- Process improvements for scope isolation between overlapping WPs — lesson
  learned, no code action needed.
- QA script improvements (`python3 -B`, `git diff` verification) — process
  guidance for future runs, not a code deliverable.

## Acceptance Criteria

- `python3 -m pytest` in `orchestrator/` reports **0 failures**.
- `test_nodes.py` no longer contains `TestRenderPrompt` or `TestLoadTemplate`.
- `test_prompt_renderer.py` passes all tests independently.
- All 4 WP-scoped node modules (`developer.py`, `qa.py`, `reviewer.py`,
  `docs.py`) use the `if wp_id else ""` guard for the `extra` variable.
- No `_qa_verify*.py`, `_verify_wp*.py`, or `_test_config.py` files exist in
  `orchestrator/`.
- `orchestrator/.gitignore` contains a pattern that ignores future
  underscore-prefixed temporary Python scripts.

## Testing Strategy

- Run `python3 -m pytest tests/test_prompt_renderer.py -v` after step 1 to
  confirm canonical renderer tests pass.
- Run `python3 -m pytest tests/test_nodes.py -v` after steps 1 and 3 to
  confirm no regressions.
- Run `python3 -m pytest tests/test_graph.py -v` after step 2 to confirm
  all 9 previously-failing tests pass.
- Run `python3 -m pytest` (full suite) as the final gate — expect 0 failures.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Removing test classes loses uncovered scenarios** | Verified that `test_prompt_renderer.py` covers all 14 scenarios from the duplicate classes plus additional edge cases (36 total tests vs 14). |
| **`aiosqlite` install breaks other packages** | `aiosqlite` is already declared in `pyproject.toml`; it's a missing install, not a new dependency. |
| **`_*.py` gitignore pattern too broad** | Pattern only applies to `orchestrator/` root directory. Verified no legitimate `_*.py` production files exist there. `__init__.py` and similar dunder files use `__` (double underscore) and are not matched by `_*.py` without a leading wildcard. |
| **Extra guard changes behaviour for empty wp_id** | `wp_id` is never empty for WP-scoped nodes in practice. The guard is a defensive no-op that aligns with the existing `wp_scope_reminder` pattern. |

---

## Implementation Summary

**Implemented:** 2026-03-26

### Changes Made

**Step 1 — Test consolidation (test_nodes.py):**
- Removed `TestRenderPrompt` class (10 test methods) and `TestLoadTemplate`
  class (5 test methods) plus their section comment headers from
  `tests/test_nodes.py` (lines 1574–1752).
- Removed the now-unused `from src.nodes.prompt_renderer import
  clear_template_cache, load_template, render_prompt` import on line 21.
- Canonical coverage remains in `tests/test_prompt_renderer.py` (36 tests).

**Step 2 — aiosqlite dependency:**
- Already installed in the virtual environment (`aiosqlite 0.22.1`). No
  action required. All 9 `test_graph.py` tests pass.

**Step 3 — Extra guard consistency:**
- Added `if wp_id else ""` guard to the `extra` variable in all 4 WP-scoped
  node modules: `developer.py`, `qa.py`, `reviewer.py`, `docs.py`.

**Step 4 — QA artifact cleanup:**
- Only `_test_config.py` remained in the orchestrator root (the 8
  `_qa_verify*.py` and 2 `_verify_wp*.py` files had already been deleted in
  a prior session). Deleted `_test_config.py`.

**Step 5 — .gitignore update:**
- Added `_*.py` to `orchestrator/.gitignore` to prevent future
  underscore-prefixed temporary Python scripts from being tracked.

### Test Results

Full suite: **622 passed, 1 skipped, 0 failures** (`python3 -m pytest`).

### Comments

- The 8 `_qa_verify*.py` and 2 `_verify_wp*.py` files referenced in the plan
  were already absent — likely cleaned up during a prior session. Only
  `_test_config.py` needed deletion.
- `aiosqlite` was already installed in the venv (v0.22.1), so the 9
  `test_graph.py` failures were not reproducible. Either the dependency was
  installed between plan authoring and implementation, or the venv was
  refreshed.
- The test count dropped from ~636 (before consolidation) to 622 as expected
  — 14 duplicate tests removed, matching the plan's prediction.
