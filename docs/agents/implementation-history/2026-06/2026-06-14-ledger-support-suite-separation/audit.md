# Plan Audit Report

## Plan Under Review
- **Plan:** `docs/agents/plans/2026-06-14-ledger-support-suite-separation/plan.md`
- **Date:** 2026-06-14
- **Auditor:** Plan Auditor Agent v1.5.0
- **Companion report:** `design-review.md` (Plan Architect Reviewer, advisory) — produced in parallel; not consulted here.

## Verdict: PASS WITH FINDINGS

### Summary
The plan is well-structured, thoroughly grounded, and ready for implementation. All file paths, function names, and API references verify against the codebase. The single major finding relates to the validation-function parameterization underspecifying the `relPath` construction — a straightforward clarification. Minor findings cover AGENTS.md prose updates and a test-ordering dependency.

### Finding Counts
- **Critical:** 0
- **Major:** 1
- **Minor:** 2

---

## Findings

### Critical

_None._

### Major

| # | Category | Finding | Plan Location | Codebase Evidence `{file_path, line_range, claim}` | Recommendation |
|---|----------|---------|---------------|----------------------------------------------------|----------------|
| 1 | Completeness | **Validation function parameterization underspecifies `relPath` construction.** Step 7.1 describes renaming the validation functions to accept a `suiteLabel` parameter and states "The only difference between standalone and ledger-support validation is the console label." In reality, both `validateStandaloneVSCodeFrontmatter()` and `validateStandaloneCCFrontmatter()` also construct `relPath` with a hardcoded `path.join('standalone', ...)` string used in warning messages. This is a second site that must use the suite label parameter, not just the header/footer console output. | Step 7.1 | `{scripts/sync-personas.js, L223, "const relPath = path.join('standalone', 'claude-code', file)"}` and `{scripts/sync-personas.js, L364, "const relPath = path.join('standalone', 'vs-code', file)"}` | Update Step 7.1 to explicitly note that `relPath` must also be parameterized (e.g. `path.join(suiteLabel, 'vs-code', file)`), or broaden the description to "all hardcoded 'standalone' references within the function body" rather than singling out "the console label." |

### Minor

| # | Category | Finding | Plan Location | Codebase Evidence `{file_path, line_range, claim}` | Recommendation |
|---|----------|---------|---------------|----------------------------------------------------|----------------|
| 1 | Completeness | **`AGENTS.md` update list is incomplete.** Step 16 mentions updating the "Which Manifest?" table, cross-system dependencies, and `.context/` table. The `AGENTS.md` file also contains a "Workspace Architecture" table (line 14) describing "two distinct sub-projects" — this prose should be updated to reflect three suites. Additionally, the "Project Statistics" table description of Personas as "assembles ledger and standalone persona files" should mention `ledger-support`. | Step 16 | `{AGENTS.md, L14, "Persona build system that assembles ledger and standalone persona files across 3 output targets"}` | Add "Workspace Architecture table description" and "Project Statistics table" to the list of AGENTS.md sections to update. |
| 2 | Risk | **Integration test `test_pm_returns_four_specs` will fail after move without Python code change.** The real-workspace integration test in `test_subagents.py` calls `load_subagents("pm", workspace_root=_WORKSPACE_ROOT)` and asserts `len(result) == 4`. After moving the 4 PM subagent files to `personas/ledger-support/`, this test will fail with `FileNotFoundError` because `load_subagents()` still only looks in `personas/standalone/`. Step 10 mentions updating test fixtures but does not call out this integration test specifically — it is the most important test to keep passing since it validates real-workspace resolution. | Step 10 | `{orchestrator/tests/test_subagents.py, L340-L342, "result = load_subagents('pm', workspace_root=_WORKSPACE_ROOT); assert len(result) == 4"}` | Step 10 already covers updating test fixtures, but add an explicit note that the `TestRealWorkspace` integration test class will validate the end-to-end path change automatically (no fixture change needed — it uses the real workspace). The key dependency is that Step 9 (Python code change) must land before Step 10's tests can pass. |

---

## Overlooked Codebase Patterns

_No overlooked existing utilities or patterns found._ The plan correctly identifies all relevant consumers and follows the established per-suite config pattern. The parameterized validation approach is a sensible evolution of the existing pattern.

| Existing Pattern | File Path | Why the Plan Should Use It |
|---|---|---|
| — | — | No overlooked patterns identified |

---

## Completeness Assessment

| Plan Section | Status | Notes |
|--------------|--------|-------|
| Summary | OK | Clear goal, correct scope. |
| Architectural Context | OK | Accurately describes the build config, suites map, and downstream consumers. |
| Approach / Architecture | OK | Third suite entry, file moves, `_shared.yaml` with `mcp_server_name` — all sound. |
| Rationale | OK | Clean separation, shared defaults, no library changes — well-justified. |
| Considered Alternatives | OK | Four decision points with trade-off analysis. |
| Pattern Alignment | OK | Correctly identifies departure from C19 and documents the parameterized validation approach. |
| Detailed Steps | OK | 18 steps covering config, file moves, script updates, orchestrator changes, documentation, build verification, and context regeneration. Steps are actionable and sequenced correctly. |
| Dependencies | OK | Correctly identifies that no library, manifest, or name-mapping changes are needed. |
| Required Components | OK | Lists all new and modified files. |
| Assumptions | OK | Reasonable assumptions about `recipe-curator`, `personaMode`, partials, and cross-suite variables. |
| Constraints | OK | `id` stability, gitignored output dirs, same frontmatter templates — all correct per codebase. |
| Out of Scope | OK | Clearly delineates follow-up work (sync generalization, manifest-driven resolution, recipe-curator review). |
| Acceptance Criteria | OK | 11 testable criteria covering build, check, orchestrator, sync, tests, docs, and context generation. |
| Testing Strategy | OK | Appropriate for a structural/config change — build verification, strict check, orchestrator integration, regression. |
| Test Plan | OK | 5 concrete test commands mapped to specific acceptance criteria. |
| Documentation Updates | OK | 17 documentation artifacts listed with specific sections to update. Comprehensive coverage of personas manifest, orchestrator manifest, root docs, and context regeneration. |
| Risks & Mitigations | OK | 8 risks with concrete mitigations covering the key failure modes. |
