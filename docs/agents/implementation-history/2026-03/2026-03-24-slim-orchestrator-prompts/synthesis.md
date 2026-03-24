# Synthesis Report — Slim Orchestrator Prompts

**Project:** `2026-03-24-slim-orchestrator-prompts`
**Generated:** 2026-03-24 (final update after full completion)
**Status at synthesis time:** COMPLETE

---

## Executive Summary

This project systematically stripped all eight orchestrator node `_build_*_prompt()` functions of redundant identity declarations, workflow step enumerations, and MCP tool-call instructions that duplicated (and potentially conflicted with) the persona system prompts. The user-turn prompt now provides only the immediate runtime context the persona cannot know: `project_path`, `wp_id` (where applicable), and the `project_path` injection-safety warning.

**All core deliverables were completed:** prompt simplification across all 8 node files (WP-001, WP-002, WP-003), a targeted test suite expansion (WP-005), and full documentation — module docstrings, changelog, and architecture reference (WP-008). Four work packages (WP-004, WP-006, WP-007, WP-009) were cancelled as their scope was superseded by the restructured work breakdown executed in the active WPs.

**Result:** 8 node files slimmed, 16 new focused tests added, all module docstrings updated, a v0.9.6 changelog entry written, and a stale architecture.md table corrected. The orchestrator now sends clean, minimal user-turn prompts across all 8 stages with no regressions.

---

## Work Package Status Summary

| WP | Description | Status | All AC Met |
|----|-------------|--------|-----------|
| WP-001 | Slim 6 WP-scoped node prompts (developer, qa, reviewer, security_auditor, release_engineer, docs) | **COMPLETE** | ✅ All 5/5 |
| WP-002 | Slim PM node prompt (`_build_pm_prompt()`) | **COMPLETE** | ✅ All 4/4 |
| WP-003 | Slim synthesis node prompt (`_build_synthesis_prompt()`) | **COMPLETE** | ✅ All 4/4 |
| WP-004 | *(Superseded)* | **CANCELLED** | — |
| WP-005 | Update orchestrator tests to match slim prompts | **COMPLETE** | ✅ All 5/5 |
| WP-006 | *(Superseded)* | **CANCELLED** | — |
| WP-007 | *(Superseded)* | **CANCELLED** | — |
| WP-008 | Update module docstrings, changelog, and architecture reference | **COMPLETE** | ✅ All 5/5 |
| WP-009 | *(Superseded)* | **CANCELLED** | — |

---

## Outcomes Achieved

### Files Modified

The following files were modified across the project:

| File | Change |
|------|--------|
| `orchestrator/src/nodes/developer.py` | `_build_developer_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/qa.py` | `_build_qa_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/reviewer.py` | `_build_reviewer_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/security_auditor.py` | `_build_security_auditor_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/release_engineer.py` | `_build_release_engineer_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/docs.py` | `_build_docs_prompt()` slimmed; module docstring updated |
| `orchestrator/src/nodes/pm.py` | `_build_pm_prompt()` slimmed (plan content preserved); module docstring updated |
| `orchestrator/src/nodes/synthesis.py` | `_build_synthesis_prompt()` slimmed (no wp_id, project-scoped); module docstring updated |
| `orchestrator/tests/test_nodes.py` | `TestSlimPromptContent` class added (16 new tests) |
| `orchestrator/changelog.md` | v0.9.6 entry added referencing all 8 changed functions |
| `orchestrator/docs/architecture.md` | Stale 'Stub' rows for security_auditor and release_engineer corrected |

### Prompt Design Applied

All eight `_build_*_prompt()` functions now conform to one of three minimal templates:

**WP-scoped stages** (developer, qa, reviewer, security_auditor, release_engineer, docs):
- Contains: `project_path`, `wp_id`, and the verbatim `project_path` injection-safety warning
- Removed: identity declarations ("You are the X agent"), numbered workflow steps, MCP tool-call syntax

**PM stage** (special):
- Contains: `project_path`, `plan_file`, injection-safety warning, and full plan document content
- Removed: identity declaration, four enumerated task steps
- Plan content embedding preserved — it is legitimate runtime data the persona cannot know

**Synthesis stage** (project-scoped):
- Contains: `project_path` and injection-safety warning only
- No `wp_id` — correctly reflects that synthesis operates project-wide, not per work package

---

## Test Results

| Pipeline Stage | WP | Tests Passed | Tests Failed | Coverage Note |
|---|---|---|---|---|
| QA (WP-001) | 6 WP-scoped nodes | 466 | 0 | 104 node-specific + 362 broader suite |
| QA (WP-002) | PM node | 466 | 0 | TestPMNodePromptIncludesPlanContent passes |
| QA (WP-003) | Synthesis node | 466 | 0 | TestSynthesisNodeNoWPRequired passes |
| QA (WP-005) | New TestSlimPromptContent class | 120 | 0 | 16 new tests + all 104 prior node tests |

All tests passed across all QA runs with **zero failures or regressions**. The slim prompt changes were backward-compatible. WP-005 added 16 positive assertions confirming the slim format for all 8 nodes, plus identity-phrase absence checks, bringing the node-specific test count from 104 to 120.

---

## Key Technical Decisions

### 1. Architecture boundary: persona vs. user-turn
**Decision:** Identity declarations and workflow step enumerations live exclusively in persona YAML files; the user-turn prompt carries only runtime context.
**Rationale:** The persona system prompt is the canonical source of truth for agent behaviour. Duplicating role identity and workflow steps in the user turn creates two competing sources of truth and — critically — user-turn content often receives higher attention weight than system prompts in LLMs, meaning the simplified (and potentially conflicting) user-turn steps could suppress the richer persona guidance.

### 2. Preserve PM plan content embedding
**Decision:** The PM prompt retains the full embedded plan document despite the broader slimming effort.
**Rationale:** Plan document content is legitimate runtime data that static persona files cannot supply. Removing it would break the PM agent's ability to perform its core function. All other removed content (identity declarations, step enumerations) was genuinely redundant with the persona.

### 3. Synthesis prompt has no `wp_id`
**Decision:** `_build_synthesis_prompt()` was deliberately designed without a `wp_id` field.
**Rationale:** Synthesis operates at project scope — it reads all work packages rather than executing work on a specific one. Including a `wp_id` would be semantically incorrect and potentially confusing.

### 4. Structural uniformity across the six WP-scoped nodes
**Decision:** All six WP-scoped prompt functions are structurally identical — 8 lines each, same f-string layout, same Unicode em-dash (`\u2014`), same `!r` repr quoting for `project_path`, same `# type: ignore[call-overload]` annotation on `state.get()`.
**Rationale:** Uniformity is a maintainability asset. Any future change to the minimal prompt pattern can be applied mechanically and predictably across all six files.

---

## Pipeline Observations & Lessons Learned

### From the Code Review (WP-001)

1. **Module docstrings lag behind the implementation.** Docstrings in `docs.py` (4-step workflow), `reviewer.py`, and `qa.py` describe what the node *does* but do not mention that the user-turn prompt is intentionally minimal. A one-liner addition would help future maintainers understand the design intent at a glance — e.g.: *"The user-turn prompt provides only runtime context (project path, WP ID, injection-safety warning); all identity and workflow guidance lives in the persona system prompt."*

2. **No artifacts declared in code-review.** The code-review pipeline completed PASS without declaring `files_modified` — flagged as a traceability gap by the project-level observer comment.

### From QA (WP-001)

3. **Graceful degradation on empty `wp_id`.** QA verified that if `state.get()` returns an empty string for `wp_id`, the function returns an empty Work package line rather than raising — a robust edge-case behaviour worth preserving in future refactors.

4. **Backward compatibility confirmed.** No existing test was asserting on old verbose prompt text, meaning the slim prompt change required no test updates in the QA phase. (WP-005 planned to add positive assertions for the slim format — see Outstanding Work below.)

### From QA (WP-002)

5. **Error handling in PM's file read.** The PM prompt function handles missing plan files with a graceful error message embedded in the prompt (rather than raising), and correctly keeps the injection-safety warning intact even in the error path — a resilient design.

### From QA and Code Review (WP-005)

6. **Module-level test sentinels improve future extensibility.** The `_IDENTITY_PHRASES` list at module level means adding a new node only requires updating one list — all 16 identity-absence tests benefit automatically. The `_assert_slim_fields_present()` triple-check (actual project_path value + `'CRITICAL'` + `'project_path'`) is robust against false positives.

7. **PM and synthesis test divergence is correctly handled.** The PM test uses `tmp_path` to provide a real plan file; the synthesis test passes `current_wp_id=''` and sets `expect_wp=False`. Both correctly reflect the asymmetric design of these two nodes.

### From Documentation (WP-008)

8. **Stale 'Stub' entries in architecture.md.** The architecture reference table still described security_auditor and release_engineer as "Stub — ... (full prompt content TBD)" despite these nodes having been fully implemented in WP-001. The Documentation agent caught and corrected this. Keeping architecture.md in sync with node implementation state is an ongoing maintenance obligation.

9. **synthesis.py is the documentation exemplar.** Its `_build_synthesis_prompt()` docstring explicitly calls out the absence of `wp_id` and the `.. note::` admonition in the factory function repeats this — the best self-documenting pattern in the codebase. WP-008 propagated this quality to all other node files.

### Recurring Pattern: Minimal, Surgical Changes
All implementation pipelines were completed quickly (20–130 seconds), with consistent notes that changes were "minimal and surgical." This reflects a well-bounded scope and good pre-existing code structure. The 130s for WP-008 reflects the breadth (9 files) rather than any complexity in the changes themselves.

---

## Metrics Summary

| Metric | Value |
|--------|-------|
| Work packages planned | 9 |
| Work packages completed | 5 (WP-001, WP-002, WP-003, WP-005, WP-008) |
| Work packages cancelled (superseded) | 4 (WP-004, WP-006, WP-007, WP-009) |
| Node source files refactored | 8 |
| Prompt functions slimmed | 8 |
| New tests added (TestSlimPromptContent) | 16 |
| Pre-existing node tests retained | 104 |
| Total node tests (final) | 120 |
| Total full-suite tests passing | 466 |
| Total test failures | 0 |
| Total regressions introduced | 0 |
| `ruff check` status | Clean on all modified files |
| Lines of redundant prompt text removed | ~15 lines per stage × 8 stages ≈ 120 lines total |
| Documentation files updated | 3 (changelog.md, architecture.md, all 8 node module docstrings) |
| Pipeline stages executed | 11 (implementation ×4, qa ×4, code-review ×4, documentation ×2) |
| Implementation pipeline durations | 123s (WP-001), 23s (WP-002), 20s (WP-003), 130s (WP-008) |

---

## Technical Debt & Follow-Up Items

All acceptance criteria were met across all active work packages. The following minor items were flagged during pipeline reviews and remain as low-priority follow-ups for a future documentation pass:

### Low Priority

1. **`test_nodes.py` module docstring node count** — Line 1 still reads "six Deep Agent stage nodes." After this project there are eight. A one-word update is sufficient. *(Flagged by Reviewer, WP-005 code-review.)*

2. **`files_modified` in code-review pipeline artifacts** — Four code-review pipelines (WP-001 through WP-005) completed PASS without declaring `artifacts.files_modified`. The project-level observer noted this as a traceability gap. Future reviewers should populate this field for audit completeness. *(Flagged by project-level comments.)*

3. **`pm.py` module docstring historical note** — The current phrasing could be read as implying the prompt was always minimal. A brief note that identity declarations and workflow steps were moved to the persona system prompt in this refactor would aid future maintainers tracing design history. *(Flagged by Reviewer, WP-002 code-review.)*

### None — No Blocking Debt

No functional bugs, no security issues, no broken tests, no regressions. The three items above are purely cosmetic/traceability concerns.

---

## Strategic Recommendations

1. **Single source of truth is now enforced for agent behaviour.** The persona files in `personas/ledger/claude-code/` are the canonical definitions of agent identity, workflow, and MCP usage. All future changes to agent behaviour should be made there, not in `_build_*_prompt()` functions. This constraint should be codified in a contributing guide or ADR.

2. **Token efficiency gains are real but secondary.** The ~120 lines removed across 8 stages save input tokens on every orchestrator invocation. At scale this is meaningful, but the primary benefit is eliminating competing instructions — not token cost.

3. **The `project_path` injection-safety warning is a permanent fixture.** It exists because persona Markdown files are static and cannot contain runtime values. This distinction — static persona vs. dynamic user-turn context — is the lasting architectural insight from this project and should inform all future prompt engineering decisions for the orchestrator.

4. **Monitor first orchestrator run with slimmed prompts.** The plan's rationale holds that user-turn content can suppress richer system-prompt guidance. Observing whether agent output quality improves (fewer hallucinated tool calls, better persona-protocol adherence) over the next few sessions will empirically validate the architectural decision.

5. **The WP planning restructure left cancelled WPs with confusing cross-references.** WP-004 references `work/WP-001.md`, WP-006 references `work/WP-002.md`, etc. — artefacts of a mid-session plan revision. Future planning should retire superseded WPs cleanly or mark them with explicit supersession notes to avoid misleading file pointers.

6. **"Documentation-forward" review comments are an effective handoff mechanism.** Reviewers consistently left deferred documentation items as structured comments, which WP-008 resolved cleanly. Formalising this as a named convention (e.g., a `documentation-forward` comment type in the review checklist) would make it a reliable cross-WP handoff pattern.
