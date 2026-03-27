
# Plan — Orchestrator Template Partials Post-Rework

## Summary

Address the four actionable strategic recommendations from the
`2026-03-26-orchestrator-template-partials` synthesis: add input-validation
guards to `load_partial()` / `load_template()`, update the stale
`architecture.md` prompt section, resolve 9 pre-existing `test_graph.py`
failures, and refactor `begin-work-developer.md` to use a
`{{> scope-restriction}}` include instead of duplicating the text inline.

## Architectural Context

The orchestrator's prompt renderer (`orchestrator/src/nodes/prompt_renderer.py`)
exposes two public loading functions:

- `load_template(stage)` — loads `.md` files from `templates/`
- `load_partial(name)` — loads `.md` files from `templates/partials/`

Both construct file paths via `Path(_DIR) / f'{name}.md'` with no explicit
validation on the `name` parameter. Path traversal is currently blocked only by
the `_INCLUDE_RE` regex (`[\w-]+`), which is a call-site constraint invisible
to direct callers. The docstrings already state names must match `[\w-]+`, but
no runtime enforcement exists.

`orchestrator/docs/architecture.md` documents the prompt architecture in its
"Prompt Architecture" section (lines ~85–180). This section still references
the pre-refactor pattern: `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER`
constants imported from `src/nodes/__init__.py`, f-string-based `extra` blocks
built in Python, and the old code examples. The template-partials refactoring
(completed in this session) replaced all of these with `{{> partial}}` includes,
making the architecture doc stale.

`orchestrator/tests/test_graph.py` has 9 tests that fail with
`ModuleNotFoundError: No module named 'aiosqlite'`. The failures are
environment-related — `aiosqlite` and `langgraph.checkpoint.sqlite` are not
installed in the dev venv. These failures predate the current session and mask
potential regressions.

`orchestrator/src/nodes/templates/partials/begin-work-developer.md` contains an
inline copy of the scope-restriction text that also exists separately in
`scope-restriction.md`. The `{{> partial}}` include directive supports exactly
one level of resolution (no recursive includes), so embedding
`{{> scope-restriction}}` inside `begin-work-developer.md` would not work with
the current renderer. However, `render_prompt()` applies include resolution
before variable substitution, so the `begin-work-developer.md` partial is
already resolved by the time the template is processed. The fix therefore
requires either (a) supporting recursive partial resolution within partials, or
(b) pre-composing the partial at a higher level.

## Approach / Architecture

Four independent work packages, one per recommendation:

1. **WP-001 — Input validation guards:** Add a `re.fullmatch(r'[\w-]+', name)`
   guard at the top of both `load_template()` and `load_partial()`, raising
   `ValueError` on invalid input. Update existing tests and add new ones
   covering the validation boundary.

2. **WP-002 — architecture.md update:** Rewrite the "Prompt Architecture"
   section and the "Three Prompt Templates" subsection to reflect the
   partial-based system. Remove references to `PROJECT_PATH_REMINDER` and
   `WP_SCOPE_REMINDER` constants (deleted in WP-004 of the prior plan). Update
   code examples to show the current `render_prompt(_TEMPLATE, {...})` pattern
   with only `project_path` and `wp_id` variables. Update the Field Reference
   table.

3. **WP-003 — test_graph.py failures:** Skip the 9 failing tests with
   `@pytest.mark.skip(reason="requires aiosqlite — not installed in dev venv")`
   so the test baseline is clean and regressions are not masked.

4. **WP-004 — begin-work-developer.md deduplication:** Add support for
   one-level-deep recursive partial resolution in `render_prompt()` (resolve
   includes within loaded partial content), then replace the inline
   scope-restriction text in `begin-work-developer.md` with
   `{{> scope-restriction}}`.

## Rationale

- **WP-001** is a defence-in-depth security hardening. The implicit regex guard
  at the call-site is fragile; a future direct caller of `load_partial()` would
  bypass it. Explicit validation at the API boundary makes path-safety
  self-documenting and immune to refactoring.

- **WP-002** fixes documentation debt flagged by multiple agents. Stale docs
  actively mislead agents reading `architecture.md` to understand the system.

- **WP-003** is test hygiene. 9 permanently-red tests create noise and risk
  masking real regressions. Skipping them with a clear reason is low-effort and
  keeps the baseline green.

- **WP-004** eliminates textual duplication. The scope-restriction text now
  lives in two files; if one is updated without the other, prompts diverge
  silently. Recursive partial resolution is a small, self-contained renderer
  enhancement.

## Detailed Steps

### WP-001 — Input validation guards

1. In `orchestrator/src/nodes/prompt_renderer.py`, add at the top of
   `load_template()`:
   ```python
   if not re.fullmatch(r'[\w-]+', stage):
       raise ValueError(f"Invalid template name '{stage}': must match [\\w-]+")
   ```
2. Add the same guard at the top of `load_partial()`:
   ```python
   if not re.fullmatch(r'[\w-]+', name):
       raise ValueError(f"Invalid partial name '{name}': must match [\\w-]+")
   ```
3. In `orchestrator/tests/test_prompt_renderer.py`, add test cases for both
   functions that verify:
   - `ValueError` raised for `../etc/passwd`
   - `ValueError` raised for names containing `.` or `/`
   - `ValueError` raised for empty string
   - Valid names (`developer`, `wp-scope-reminder`) still work
4. Update `orchestrator/docs/agents/project-manifest/api-surface.md` to
   document the new `ValueError` raise condition for both functions.

### WP-002 — architecture.md update

1. In `orchestrator/docs/architecture.md`, replace the "Prompt Architecture"
   section (starting at "## Prompt Architecture") with updated content:
   - Remove all references to `PROJECT_PATH_REMINDER` and `WP_SCOPE_REMINDER`
     constants from `src/nodes/__init__.py` (these no longer exist).
   - Replace the code examples for "Minimal pattern" and "SCOPE RESTRICTION
     pattern" with current-state examples showing only `project_path` and
     `wp_id` as variables dict keys.
   - Update the Field Reference table to show the simplified variable set:
     `project_path` + `wp_id` for WP-scoped stages, `project_path` +
     `plan_file` + `extra` for PM, `project_path` for synthesis.
   - Update the "Two-layer prompt scope reinforcement" text to reference
     `{{> wp-scope-reminder}}`, `{{> scope-restriction}}`, and
     `{{> begin-work-developer}}` partials instead of Python f-strings.
   - Add a brief subsection documenting the `{{> partial}}` include mechanism
     and the 5 extracted partials.
   - Document the module-level `_TEMPLATE = load_template('stage')` caching
     pattern as an explicit performance convention (recommendation #5 from
     synthesis).
2. Update `orchestrator/docs/agents/project-manifest/constraints.md` if the
   architecture description there references the old constant names.

### WP-003 — test_graph.py failures

1. In `orchestrator/tests/test_graph.py`, add
   `@pytest.mark.skip(reason="requires aiosqlite — not installed in dev venv")`
   to each of the 9 failing test methods:
   - `TestBuildGraphReturnType::test_build_graph_returns_object`
   - `TestBuildGraphReturnType::test_compiled_graph_is_callable`
   - `TestGraphNodes::test_graph_has_nine_nodes`
   - `TestGraphEdges::test_start_edges_to_supervisor`
   - `TestGraphEdges::test_loop_stages_edge_to_supervisor`
   - `TestGraphEdges::test_synthesis_edges_to_end`
   - `TestCheckpointerCreated::test_checkpoint_dir_created`
   - `TestCheckpointerIsAsync::test_checkpointer_supports_async`
   - `TestCheckpointerIsAsync::test_graph_ainvoke_does_not_raise_not_implemented`
2. Run the full test suite to verify 0 failures.

### WP-004 — begin-work-developer.md deduplication

1. In `orchestrator/src/nodes/prompt_renderer.py`, extend the include
   resolution in `render_prompt()` to also resolve `{{> partial}}` directives
   within loaded partial content (one additional pass — not fully recursive,
   just one level deep within partials). This prevents unbounded recursion
   while enabling partial composition.
2. Add tests for one-level-deep partial include:
   - A partial containing `{{> other-partial}}` resolves correctly.
   - A partial containing a nested partial that itself contains `{{> ...}}`
     does NOT resolve (only one level).
3. Replace the inline scope-restriction text in
   `orchestrator/src/nodes/templates/partials/begin-work-developer.md` with
   `{{> scope-restriction}}`.
4. Run existing tests to verify no regressions; the rendered output for the
   developer template should be identical before and after the change.
5. Update `orchestrator/docs/agents/project-manifest/api-surface.md` and
   `constraints.md` to document the one-level-deep partial include behaviour.
6. Update `orchestrator/src/nodes/templates/VARIABLES.md` if it references the
   old inline scope-restriction text.

## Dependencies

- WP-001 through WP-004 are fully independent and can be executed in parallel.
- WP-004's renderer extension (recursive partial resolution) does not break any
  existing behaviour: no current partial contains include directives, so the
  added pass is a no-op until `begin-work-developer.md` is updated.

## Required Components

- `orchestrator/src/nodes/prompt_renderer.py` — WP-001 (validation), WP-004
  (recursive include)
- `orchestrator/tests/test_prompt_renderer.py` — WP-001 (new tests), WP-004
  (new tests)
- `orchestrator/docs/architecture.md` — WP-002
- `orchestrator/docs/agents/project-manifest/api-surface.md` — WP-001, WP-004
- `orchestrator/docs/agents/project-manifest/constraints.md` — WP-002, WP-004
- `orchestrator/tests/test_graph.py` — WP-003
- `orchestrator/src/nodes/templates/partials/begin-work-developer.md` — WP-004
- `orchestrator/src/nodes/templates/VARIABLES.md` — WP-004

## Assumptions

- `aiosqlite` will not be installed in the dev environment for now; skipping the
  tests is the preferred approach (synthesis recommendation #4).
- The one-level-deep partial include extension is sufficient for current needs;
  full recursive include resolution is not required and would add complexity.
- The `architecture.md` prompt section rewrite will not require changes to the
  MCP Tool Wrapping or WorkflowState sections, which are still accurate.

## Constraints

- The `[\w-]+` validation regex must match the existing `_INCLUDE_RE` capture
  group to maintain consistency.
- No new dependencies may be added.
- Cross-platform rules apply per root `AGENTS.md`.
- All changes must pass the existing test suite with 0 failures (after WP-003
  skips are applied).

## Out of Scope

- Installing `aiosqlite` in the dev environment (a separate decision).
- Full recursive (unbounded depth) partial resolution.
- Changes to persona files or MCP server code.
- Changes to the prompt templates themselves (only the partial composition is
  affected in WP-004).

## Acceptance Criteria

- `load_template("../foo")` and `load_partial("../foo")` both raise
  `ValueError`.
- `load_template("developer")` and `load_partial("wp-scope-reminder")` still
  work correctly.
- `architecture.md` no longer references `PROJECT_PATH_REMINDER`,
  `WP_SCOPE_REMINDER`, or f-string-based prompt building.
- `architecture.md` documents the partial include system and the 5 partials.
- `architecture.md` documents module-level template caching as a convention.
- Full test suite passes with 0 failures (9 `test_graph.py` tests skipped).
- `begin-work-developer.md` uses `{{> scope-restriction}}` instead of inline
  text.
- Rendered developer prompt output is byte-identical before and after WP-004.
- `api-surface.md` documents `ValueError` for invalid names and one-level
  partial include behaviour.

## Testing Strategy

- **WP-001:** Unit tests in `test_prompt_renderer.py` covering valid names,
  path-traversal attempts, dot-containing names, slash-containing names, and
  empty strings for both `load_template()` and `load_partial()`.
- **WP-002:** Manual review — no automated test (documentation-only change).
- **WP-003:** Run `pytest tests/test_graph.py -v` and verify 9 skipped, 0
  failed.
- **WP-004:** Unit tests verifying one-level partial include resolution,
  regression tests comparing rendered developer template output before/after.
  Full suite run to confirm 0 failures.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Validation regex too strict** — rejects valid template/partial names in future | The `[\w-]+` pattern allows all alphanumeric, underscore, and hyphen characters, which covers all current and foreseeable naming conventions. Loosen only if a concrete need arises. |
| **One-level include insufficient for future partials** | Document the one-level constraint explicitly. If deeper composition is needed later, it can be extended to N-level with a depth counter. |
| **architecture.md rewrite introduces inaccuracies** | Code review pipeline validates doc changes against actual source. |
| **Skipping test_graph.py tests hides real regressions** | The skip reason is explicit and searchable. A future plan can address the `aiosqlite` dependency properly. |
