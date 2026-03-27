# Project Synthesis — Orchestrator Template Partials

**Plan:** `2026-03-26-orchestrator-template-partials`
**Date:** 2026-03-26
**Status:** COMPLETE
**Prepared by:** Head of Operations (Synthesis)

---

## Executive Summary

This session extracted five hardcoded prompt text fragments from Python constants and
f-strings into editable Markdown partial files, introduced a `{{> partial-name}}` include
directive to the orchestrator's template renderer, and propagated the change through all 8
stage templates, 7 Python node modules, and the orchestrator's project manifest. The result
is a cleaner separation of concerns: prompt text lives entirely in `.md` files, and Python
node modules are reduced to thin `render_prompt()` wrappers that pass only runtime-dynamic
variables.

All 7 work packages completed. 47 tests in `test_prompt_renderer.py` pass; broader suite
623 green (622 after WP-004 removes one now-invalid test). Zero regressions. One rework
cycle on WP-001 (duplicate test method, caught by code review, fixed same session).

---

## Work Package Summary

| WP | Title | Status | Pipelines | Tests |
|----|-------|--------|-----------|-------|
| WP-001 | `load_partial()` + `{{> partial}}` renderer | COMPLETE | impl → qa → security → review → docs | 46 pass |
| WP-002 | Extract 5 partial `.md` files | COMPLETE | impl → review | 5 files verified |
| WP-003 | Update 8 stage templates + 8 node modules | COMPLETE | impl → qa → review | 623 pass |
| WP-004 | Remove orphaned constants + `build_stage_prompt()` | COMPLETE | impl → qa → review | 622 pass |
| WP-005 | Update `VARIABLES.md` | COMPLETE | docs | — |
| WP-006 | Test coverage for partial includes | COMPLETE | impl → qa → review | 47 pass |
| WP-007 | Update `constraints.md` + `api-surface.md` | COMPLETE | docs | — |

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 7 / 7 |
| All acceptance criteria met | 54 / 54 |
| `test_prompt_renderer.py` tests | 47 pass, 0 fail |
| Full suite (excl. pre-existing failures) | 623 pass, 0 fail |
| Security findings — Critical / High / Medium | 0 / 0 / 0 |
| Security findings — Low (defence-in-depth) | 2 (informational) |
| Code review rework cycles | 1 (WP-001: duplicate test method name) |
| Reviewer fix-forward patches | 3 (VARIABLES.md stale sections × 2; test WP reference × 1) |
| Production files modified | 20 |
| New partial files created | 5 |

---

## Files Modified

**Renderer (core change):**
- `orchestrator/src/nodes/prompt_renderer.py` — `load_partial()`, `_INCLUDE_RE`, Step 0
  include resolution, updated `clear_template_cache()`, improved docstrings

**Partial files (new):**
- `orchestrator/src/nodes/templates/partials/project-path-reminder.md`
- `orchestrator/src/nodes/templates/partials/wp-scope-reminder.md`
- `orchestrator/src/nodes/templates/partials/scope-restriction.md`
- `orchestrator/src/nodes/templates/partials/begin-work-developer.md`
- `orchestrator/src/nodes/templates/partials/pm-preamble.md`

**Stage templates (all 8 updated):**
- `orchestrator/src/nodes/templates/{developer,qa,reviewer,docs,security_auditor,release_engineer,pm,synthesis}.md`

**Stage templates — reference file:**
- `orchestrator/src/nodes/templates/VARIABLES.md`

**Node modules (all simplified):**
- `orchestrator/src/nodes/{developer,qa,reviewer,docs,security_auditor,release_engineer,pm,synthesis}.py`

**Deleted dead code:**
- `orchestrator/src/nodes/__init__.py` — removed `PROJECT_PATH_REMINDER`, `WP_SCOPE_REMINDER`,
  and `build_stage_prompt()`

**Tests:**
- `orchestrator/tests/test_prompt_renderer.py` — 11 new tests in WP-001; 2 new tests in
  WP-006; duplicate method fix; removed `test_public_constants_importable_from_nodes`

**Manifest docs:**
- `orchestrator/docs/agents/project-manifest/constraints.md`
- `orchestrator/docs/agents/project-manifest/api-surface.md`

---

## Strategic Recommendations (Gold Nuggets)

### 1. Add input validation to `load_partial()` / `load_template()` [HIGH priority]

The Security Auditor (WP-001) flagged a defence-in-depth gap: both public functions
construct file paths via `Path(_DIR) / f'{name}.md'` with no validation on the `name`
parameter. Path traversal (`../../../etc/passwd`) is currently blocked by the `_INCLUDE_RE`
call-site regex (`[\w-]+` forbids `.` and `/`), but that constraint is implicit and
invisible to future callers.

**Recommended fix:** Add an explicit guard in both functions:
```python
if not re.fullmatch(r'[\w-]+', name):
    raise ValueError(f"Invalid partial name '{name}': must match [\\w-]+")
```
This makes path-safety self-documenting at the API boundary.
File: `orchestrator/src/nodes/prompt_renderer.py`, `load_template()` and `load_partial()`.

### 2. Update `orchestrator/docs/architecture.md` [MEDIUM priority — documentation debt]

Multiple agents (Developer, QA, Reviewer across WP-003 and WP-004) flagged that
`architecture.md` still describes the pre-refactor variables dict shapes
(`project_path_reminder`, `wp_scope_reminder`, `preamble` fields). This document now
contradicts the actual implementation.

**Recommended fix:** Update the variables dict section to reflect:
- Most stages: `{project_path, wp_id}`
- PM stage: `{project_path, plan_file, extra}`
- Synthesis stage: `{project_path}`
- Also update the two-layer scope reinforcement section to reference
  `{{> wp-scope-reminder}}` and `{{> scope-restriction}}` partials.

### 3. Refactor `begin-work-developer.md` to avoid duplication [LOW priority]

`begin-work-developer.md` currently embeds the scope-restriction text inline, duplicating
`scope-restriction.md`. This was intentional for the extraction phase (WP-002 faithfully
captured the existing f-string). A future WP can refactor the file to use
`{{> scope-restriction}}` once the include depth architecture allows or a simple
string-replacement is acceptable.

### 4. Resolve pre-existing `test_graph.py` failures [MEDIUM priority — test debt]

`tests/test_graph.py` has 9 permanently failing tests due to a missing `aiosqlite`
package in the dev environment. All agents noted this is unrelated to the current work,
but leaving ~1.4% of the test suite permanently red risks masking real regressions.

**Recommended fix:** Either install `aiosqlite` and `langgraph.checkpoint.sqlite` in
the dev environment, or mark the 9 tests with `@pytest.mark.skip(reason="requires
aiosqlite")` to keep the test baseline clean.

### 5. Module-level template caching is an excellent established pattern [ARCHITECTURE NOTE]

The `_TEMPLATE = load_template('stage')` pattern at module import time avoids repeated
disk I/O per agent run. This pattern is now consistently applied across all 8 node
modules and is worth documenting explicitly in `architecture.md` as a performance
convention.

---

## Process Observations

- **One rework cycle** on WP-001: a duplicate method name in `TestLoadPartial`
  (`test_returns_string`) caused Python to silently drop the first definition. The
  code review caught this before it could propagate. Both the lost `load_partial`
  str-type coverage and the misplaced `load_template` coverage were correctly restored.

- **Three Reviewer fix-forward patches** applied inline without blocking the pipeline:
  - WP-003: Removed stale duplicate PM/Synthesis code examples from `VARIABLES.md`
  - WP-003: Updated stale `WP_SCOPE_REMINDER.format()` guidance in `VARIABLES.md` Notes
  - WP-004: Corrected a stale WP reference (`WP-002` → `WP-004`) in
    `test_build_stage_prompt_not_in_nodes` docstring

- **Traceability gap noted**: Four code-review pipelines (WP-001, WP-002, WP-004, WP-006)
  completed PASS without declaring `artifacts.files_modified`. Consider enforcing this
  in future workflow runs for better audit trails.

---

## Next Steps

1. **Immediate:** Add input validation guards to `load_partial()` / `load_template()`
   (Security Auditor recommendation, low-effort, high-value defence-in-depth).
2. **Short-term:** Update `orchestrator/docs/architecture.md` to reflect the current
   partial-based prompt architecture and simplified variables dict shapes.
3. **Short-term:** Resolve `test_graph.py` failing tests (install `aiosqlite` or skip).
4. **Future (optional):** Refactor `begin-work-developer.md` to use
   `{{> scope-restriction}}` include to eliminate the inline duplication.
