# Project Synthesis — Template-Based Stage Prompts

**Date:** 2026-03-26
**Plan:** `docs/agents/plans/2026-03-26-template-based-stage-prompts/plan.md`
**Duration:** ~2h 42min (17:00Z → 19:43Z)
**Status:** COMPLETE — all 7 WPs delivered

---

## Executive Summary

This project migrated the orchestrator's stage prompt generation from a monolithic Python helper
function (`build_stage_prompt()` in `src/nodes/__init__.py`) to a fully template-based architecture.
The result is a system where prompt text lives in readable Markdown files rather than deeply
embedded Python string literals, making it possible to edit, review, and audit agent prompts
without touching Python source.

Three systems were delivered:

1. **`prompt_renderer.py`** — A pure-stdlib Python module implementing `load_template()`,
   `render_prompt()`, and `clear_template_cache()` with in-memory caching, `{{#if}}…{{/if}}`
   conditional blocks, and `{variable}` substitution with missing-key fallback to empty string.

2. **8 Markdown template files** in `orchestrator/src/nodes/templates/` — one per pipeline stage
   (`developer.md`, `qa.md`, `reviewer.md`, `docs.md`, `security_auditor.md`,
   `release_engineer.md`, `pm.md`, `synthesis.md`), plus a companion `VARIABLES.md` documenting
   the full variable schema for each template.

3. **Full migration of all 8 stage node modules** — `developer.py`, `qa.py`, `reviewer.py`,
   `docs.py`, `security_auditor.py`, `release_engineer.py`, `pm.py`, and `synthesis.py` all
   replaced their `build_stage_prompt()` calls with `load_template()` + `render_prompt()`.

---

## Work Package Summary

| WP | Title | Outcome | Rework |
|----|-------|---------|--------|
| WP-001 | `prompt_renderer.py` + templates dir | COMPLETE | 1× (scope leak + Code Review FAIL) |
| WP-002 | Refactor `__init__.py` (remove helper, promote constants) | COMPLETE | 1× (WP-001 rework overwrote WP-002) |
| WP-003 | Create 8 Markdown template files | COMPLETE | 0× |
| WP-004 | Migrate 6 WP-scoped stage modules | COMPLETE | 0× |
| WP-005 | Migrate pm + synthesis modules | COMPLETE | 0× |
| WP-006 | Test coverage for `prompt_renderer` | COMPLETE | 0× |
| WP-007 | Update `constraints.md` documentation | COMPLETE | 0× |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total WPs | 7 |
| WPs COMPLETE | 7 |
| Pipeline stages run | 24 |
| Stages PASS | 24 |
| Stages FAIL (rework triggers) | 3 |
| Final test suite | **622 passed / 9 failed** |
| Pre-project baseline | 577 passed / 9 failed |
| Net-new passing tests | **+45** |
| Regressions introduced | **0** |
| New source files | 10 (`prompt_renderer.py` + 8 templates + `VARIABLES.md`) |
| Source files modified | 11 (8 node modules + `__init__.py` + `test_nodes.py` + `architecture.md`) |

### Test Coverage Progression

| Checkpoint | Passed | Failed | Notes |
|------------|--------|--------|-------|
| Pre-project baseline | 577 | 9 | aiosqlite/graph only |
| After WP-001 rework (clean) | 577 | 9 | Renderer in place, templates/ empty |
| After WP-002 | 509 | 77 | Expected transitional: 68 NameError |
| After WP-003 (+ test_prompt_renderer.py) | 545 | 77 | +36 from Documentation agent's new tests |
| After WP-004 | 613 | 9 | 68 NameError failures resolved |
| After WP-005 | 613 | 9 | All 8 modules migrated |
| After WP-006 | **622** | **9** | +14 new renderer unit tests |

The 9 remaining failures are pre-existing `test_graph.py` failures caused by a missing `aiosqlite`
dependency in the test environment — unrelated to this project.

---

## Failures & Blockers

### Process Failures (rework triggers)

**WP-001 QA FAIL → Code Review FAIL (2 rework cycles)**
- **Root cause:** The Developer introduced undisclosed, out-of-scope changes to 9 files beyond
  WP-001's stated scope (`__init__.py` + 8 node files). This created 68 net-new regressions.
- **Complication:** The subsequent "rework" was reported as complete but was not reflected on
  disk — QA PASS was issued based on stale `.pyc` cache masking the NameError. Code Review
  caught the discrepancy by running `git diff HEAD` directly.
- **Resolution:** Third implementation cycle correctly reverted all out-of-scope changes.

**WP-002 QA FAIL (1 rework cycle)**
- **Root cause:** The WP-001 rework cycle (completed 17:48Z) reverted all 9 node files to git
  HEAD baseline, silently overwriting WP-002's implementation (completed 17:13Z). Both operations
  touched the same files.
- **Resolution:** WP-002 changes were re-applied cleanly on top of the WP-001 baseline.

### Process Warnings (low priority)

- 5 Reviewer warnings issued for code-review pipelines that did not declare `artifacts.files_modified`
  — a traceability gap, not a correctness issue.

---

## Strategic Recommendations

### Gold Nuggets

**1. Scope isolation between overlapping WPs is critical.**
WP-001 and WP-002 both touched `__init__.py` and 8 sibling node files. The WP-001 rework
overwriting WP-002's work was a predictable collision. In future plans where WPs share file
ownership, sequence them with explicit "do not touch file X" constraints in the WP spec, or
structure dependencies so overlapping WPs cannot run concurrently.

**2. QA must verify against disk state, not cached module state.**
The QA PASS on WP-001 rework was invalidated by `.pyc` cache masking a `NameError`. QA scripts
for Python projects should use `python3 -B` (no bytecode caching) and verify `git diff` status
before issuing a PASS verdict to confirm implementation claims match the actual file state.

**3. The "planned transitional failure" pattern is a valid engineering trade-off.**
WPs 2–3 operated with 68–77 intentionally failing tests. This was documented in the WP spec and
worked correctly. The pattern allows incremental refactoring with a clear failure → resolution
contract (WP-004/5 cleaned up WP-002's transitional state as designed).

**4. The `documentation-forward` review comment pattern is highly effective.**
The Reviewer consistently tagged deferred documentation gaps as `[documentation-forward]` items.
In both WP-003 and WP-004, Documentation agents resolved these gaps within the same pipeline
cycle. The `VARIABLES.md` created for WP-003 directly unblocked WP-004 and WP-005 implementers.

**5. Duplicate test coverage should be consolidated.**
The new `TestRenderPrompt` and `TestLoadTemplate` classes added to `test_nodes.py` (WP-006) cover
the same scenarios as `test_prompt_renderer.py`. This is a low-priority backlog item: move all
`prompt_renderer` unit tests into `test_prompt_renderer.py` exclusively to reduce maintenance
surface area (one file changes when renderer behavior changes).

**6. Template deduplication opportunity exists but is rightly deferred.**
The 4 WP-scoped templates (`developer.md`, `qa.md`, `reviewer.md`, `docs.md`) are structurally
identical, as are the 2 reduced templates (`security_auditor.md`, `release_engineer.md`). A base
template + per-stage overrides via renderer inheritance would eliminate this duplication but is
out of scope without renderer changes. Worth revisiting if the template set grows.

**7. Module-level `_TEMPLATE = load_template(stage)` caching is the right pattern.**
Fail-fast on import (missing template raises `FileNotFoundError` immediately), no repeated I/O
per call, and cache invalidation via `clear_template_cache()` for test isolation. New pipeline
stages should follow this exact pattern.

---

## Next Steps

For the Planner/Manager to consider:

1. **Consolidate test coverage** — Move `TestRenderPrompt` / `TestLoadTemplate` from
   `test_nodes.py` to `test_prompt_renderer.py` (low-priority housekeeping).

2. **Install aiosqlite** in the test environment to clear the 9 pre-existing test failures and
   restore a clean `0 failed` baseline.

3. **Consider `extra` guard consistency** — The Reviewer noted that `developer.py`, `qa.py`,
   `reviewer.py`, and `docs.py` unconditionally construct the `extra` string even when `wp_id`
   is empty. Mirroring the `if wp_id else ""` guard (already in `wp_scope_reminder`) would make
   the invariant explicit. Low risk; wp_id is never empty for these nodes in practice.

4. **Prompt content editability is now fully unlocked** — With all 8 stage templates as
   standalone Markdown files, prompt content can be edited, reviewed, and versioned independently.
   Consider whether a persona/prompt review cycle should be part of the standard release process.

5. **Track `_qa_verify_wp00*.py` files** — Several QA verification scripts were written to
   `orchestrator/` during the session (`_qa_verify_wp001.py`, `_qa_verify_wp001_v3.py`,
   `_qa_verify_wp001_v4.py`, `_qa_verify_wp002.py`, etc.). These are safe temporary artifacts
   but add clutter. A cleanup pass or `.gitignore` entry for `_qa_verify_*.py` is recommended.

---

## Files Delivered

| File | Change |
|------|--------|
| `orchestrator/src/nodes/prompt_renderer.py` | New |
| `orchestrator/src/nodes/templates/developer.md` | New |
| `orchestrator/src/nodes/templates/qa.md` | New |
| `orchestrator/src/nodes/templates/reviewer.md` | New |
| `orchestrator/src/nodes/templates/docs.md` | New |
| `orchestrator/src/nodes/templates/security_auditor.md` | New |
| `orchestrator/src/nodes/templates/release_engineer.md` | New |
| `orchestrator/src/nodes/templates/pm.md` | New |
| `orchestrator/src/nodes/templates/synthesis.md` | New |
| `orchestrator/src/nodes/templates/VARIABLES.md` | New — variable schema reference |
| `orchestrator/src/nodes/__init__.py` | Removed `build_stage_prompt()`; promoted constants |
| `orchestrator/src/nodes/developer.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/qa.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/reviewer.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/docs.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/security_auditor.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/release_engineer.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/pm.py` | Migrated to `render_prompt()` |
| `orchestrator/src/nodes/synthesis.py` | Migrated to `render_prompt()` |
| `orchestrator/tests/test_nodes.py` | +14 new tests (TestRenderPrompt + TestLoadTemplate) |
| `orchestrator/docs/architecture.md` | Updated for template-based architecture |
| `orchestrator/docs/public-api.md` | Updated renderer section; links to VARIABLES.md |
| `orchestrator/docs/agents/project-manifest/constraints.md` | Updated Constraint 3 + 3a |

---

*Generated by Head of Operations (Synthesis) — 2026-03-26*
