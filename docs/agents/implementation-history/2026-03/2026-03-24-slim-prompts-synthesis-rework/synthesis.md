# Project Synthesis Report

**Project:** 2026-03-24-slim-prompts-synthesis-rework  
**Date:** 2026-03-24  
**Status:** COMPLETE  
**Work Packages:** 5 / 5 complete  
**Pipeline Health:** All 5 WPs — all active stages PASS  

---

## Executive Summary

This project translated six strategic recommendations from the prior `2026-03-24-slim-orchestrator-prompts` session into **permanent codebase knowledge**. The slim-prompts session established a critical design boundary (persona files own agent identity; user-turn prompts carry only runtime context), but that insight lived only in a synthesis report. This project codified it into authoritative reference files that will be discovered and respected by future development agents.

Five work packages were completed across a single session spanning approximately 21 minutes (15:29–15:45 UTC). All deliverables are documentation and convention artifacts — no runtime behaviour was changed.

### What was built

| WP | Deliverable | Primary File(s) |
|---|---|---|
| WP-001 | Created `orchestrator/docs/agents/project-manifest/constraints.md` with 11 numbered constraints | `orchestrator/docs/agents/project-manifest/constraints.md` |
| WP-002 | Added "Prompt Architecture" section to `orchestrator/docs/architecture.md` | `orchestrator/docs/architecture.md` |
| WP-003 | Fixed stale "six" → "eight" docstring; added supersession metadata to 4 cancelled WP JSON files | `orchestrator/tests/test_nodes.py`, 4× ledger JSON |
| WP-004 | Formalised the `[documentation-forward]` convention in the Reviewer persona source partial; rebuilt all 18 personas | `personas/shared/partials/reviewer-operational-protocol.md` |
| WP-005 | Updated orchestrator manifest README: Manifest Sections table + file tree now reference `constraints.md` | `orchestrator/docs/agents/project-manifest/README.md` |

---

## Metrics

### Test Coverage

| Metric | Value |
|---|---|
| Tests passed (test_nodes.py) | 120 / 120 |
| Tests passed (full suite, excl. test_graph.py) | 473 / 473 |
| Pre-existing failures (test_graph.py) | 9 (unrelated — missing `aiosqlite` dev dependency) |
| Persona build check (`--check`) | PASS — all 18 personas up-to-date |

### Pipeline Summary

| WP | Implementation | QA / Code-Review | Documentation | Duration |
|---|---|---|---|---|
| WP-001 | PASS | PASS (code-review) | PASS | ~4 min |
| WP-002 | PASS | PASS (code-review) | PASS | ~11 min |
| WP-003 | PASS | PASS (qa) | PASS | ~8 min |
| WP-004 | PASS | PASS (code-review) | PASS | ~8 min |
| WP-005 | PASS | PASS (code-review) | PASS | ~3 min |

### Fix-Forwards Applied by Reviewers

Three reviewer-applied fixes were applied (all documentation-only, zero behavioural impact):

1. **WP-001:** Added missing `Forbidden patterns (if applicable)` row to the Constraint Entry Format table in `constraints.md`, aligning it with the `mcp-server` reference format.
2. **WP-002:** Corrected stale persona path `vs-code` → `claude-code` at `architecture.md` line 14, eliminating an internal contradiction with the newly added Prompt Architecture section.
3. **WP-005:** Reordered Manifest Sections table rows so `constraints.md` appears before `api-surface.md`, matching the file tree ordering.

---

## Deliverable Detail

### WP-001 — Orchestrator Constraints File

`orchestrator/docs/agents/project-manifest/constraints.md` was created with **11 numbered constraints** structured to match the established `mcp-server` reference format (Rule / Rationale / Anti-pattern / Correct-pattern). The file promotes all 7 pre-existing inline constraints from the orchestrator manifest README and adds 4 new constraints:

- **#1 — Persona-as-source-of-truth**: Persona files own agent identity; `_build_*_prompt()` functions carry only runtime context.
- **#2 — `project_path` injection-safety warning permanence**: The warning is a required fixture in every user-turn prompt, never optional.
- **#3 — Prompt structural uniformity**: All six WP-scoped prompt functions must remain structurally identical.
- **#10 — `documentation-forward` convention**: Named convention for cross-pipeline documentation handoffs.

The README's inline constraints section was replaced with a pointer to `constraints.md` (eliminating two-source drift risk), and the file tree was updated.

### WP-002 — Prompt Architecture Section

`orchestrator/docs/architecture.md` received a new `## Prompt Architecture` section (positioned between "Stage Nodes (Deep Agents)" and "MCP Tool Wrapping") covering:

- The **persona owns identity / user-turn owns context** design principle
- **Three prompt template categories**: WP-scoped ×6, PM (with plan content), Synthesis (no wp_id)
- A **field reference matrix** table
- The **`project_path` injection-safety warning**: why it exists and why it's permanent
- A **pointer to `personas/ledger/claude-code/`** and the `node scripts/build-personas.js` build system (with workspace-root location note added by the Documentation pipeline)

A pre-existing stale path reference (`vs-code/` → `claude-code/`) at line 14 was corrected as a reviewer Fix-Forward.

### WP-003 — Technical Debt Fixes

Two targeted debt items resolved:

1. `orchestrator/tests/test_nodes.py` line 2 docstring corrected: "six Deep Agent stage nodes" → "eight Deep Agent stage nodes". All 120 `test_nodes.py` tests pass.
2. Four cancelled WP JSON files (`WP-004`, `WP-006`, `WP-007`, `WP-009`) in `mcp-server/storage/ledger/2026-03-24-slim-orchestrator-prompts/` now carry explicit `superseded_by` and `supersession_note` fields, making the mid-session plan revision auditable.

**Pre-existing issue surfaced (not introduced):** `orchestrator/tests/test_graph.py` has 9 import-time failures due to missing `aiosqlite` dev dependency. Exit code remains 0 because pytest catches the import errors; however, the tests are effectively not running.

### WP-004 — Documentation-Forward Convention

The `[documentation-forward]` convention was formalised in `personas/shared/partials/reviewer-operational-protocol.md` (the source partial for the Reviewer persona). The new block defines:

- Convention name and purpose (does not block PASS; surfaces documentation gaps for the Documentation agent)
- JSON format with `type`/`priority`/`note` fields and the `[documentation-forward]` note prefix
- Priority guidelines (high/medium/low)
- Resolution ownership (Documentation agent)
- 4 concrete note examples

All 18 personas were rebuilt from source; the convention is confirmed present in the generated `6-reviewer.md` (both `claude-code/` and `vs-code/` targets). The convention is also codified in `constraints.md` Constraint #10 — the two documents are mutually consistent.

### WP-005 — Orchestrator Manifest README Update

`orchestrator/docs/agents/project-manifest/README.md` Manifest Sections table now includes a `constraints.md` row with a working relative link. File tree lists `constraints.md` alongside `api-surface.md`. The `## Constraints & Conventions` section heading is preserved. Three of four acceptance criteria were already satisfied by WP-001 work; this WP delivered only the missing table row (plus a reviewer Fix-Forward ordering the table to match the file tree).

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Resolve the `aiosqlite` test gap (Medium priority)

`orchestrator/tests/test_graph.py` has 9 tests that fail at import time due to `ModuleNotFoundError: aiosqlite`. The overall suite still exits 0 because pytest catches the import error, but these tests are silently not running. Fix: either add `aiosqlite` to dev extras (`pyproject.toml`), or add `pytest.importorskip('aiosqlite')` guards so the tests are explicitly skipped and visible in the report.

**Relevant WP:** WP-003 (flagged by both Developer and QA pipelines)

### 2. README File Tree and Table ordering (Low priority)

In `orchestrator/docs/agents/project-manifest/README.md`, `constraints.md` appears before `api-surface.md` in the file tree but was originally placed after it in the Manifest Sections table. The Reviewer fixed the ordering in WP-005, but future authors adding entries to either list should be aware of this consistency requirement.

### 3. Tier 2 vs. Tier 3 structural asymmetry in reviewer partial (Low priority)

In `personas/shared/partials/reviewer-operational-protocol.md`, Tier 2 (Fix-Forward) uses a bullet list while Tier 3 (Documentation-Forward) uses a formal convention block with JSON and examples. The asymmetry is intentional and appropriate (Tier 3 requires machine-readable formality), but future partial authors should understand the rationale to avoid "correcting" it.

### 4. `build-personas.js` is a full rebuild (Informational)

The persona build script always rebuilds all 18 personas — there is no incremental per-file rebuild. Any change to any source partial triggers a full rebuild. This is working as designed, but authors should be aware that running `node scripts/build-personas.js` modifies all 18 output files even when only one source was changed, which can produce noisy diffs.

### 5. Constraints format table completeness (Low priority)

The Constraint Entry Format table in `orchestrator/docs/agents/project-manifest/constraints.md` now matches the `mcp-server` reference model (including the `Forbidden patterns` row, added by Reviewer Fix-Forward in WP-001). Future constraints added to the orchestrator constraints file should follow this 5-row table format to maintain consistency with the reference model.

---

## Next Steps

1. **Install `aiosqlite` or add skip guard** — `orchestrator/tests/test_graph.py` is the only unresolved quality issue from this session. Prioritise in the next development pass.
2. **Monitor agent adoption of the `[documentation-forward]` convention** — This convention was formalised in WP-004 and is now in the generated Reviewer persona. Watch the next few review pipelines to confirm the convention is being used correctly and that Documentation agents are resolving the flagged items.
3. **Consider an `orchestrator/docs/agents/project-manifest/api-surface.md` review** — The `api-surface.md` file is now listed in both the file tree and the Manifest Sections table, but was never the subject of any WP in this session. If it was created as a placeholder, it may need content.
4. **No further follow-on work packages from this plan** — All six strategic recommendations from the prior synthesis have been addressed. This plan is fully closed.

---

## Project Comments

| Priority | Agent | Note |
|---|---|---|
| Low | Reviewer | WP-004 code-review completed without declaring `artifacts.files_modified` — traceability gap |
| Low | Documentation | WP-003, WP-004, WP-005 documentation pipelines completed without declaring `artifacts.files_modified` for files with no documentation changes — expected for no-op passes |

*All four project-level warnings are low-priority ledger hygiene items (missing `files_modified` declarations on pipelines that either had no file changes or omitted the field). No functional or quality impact.*

---

*Synthesis generated by Head of Operations (Synthesis Agent) — 2026-03-24*
