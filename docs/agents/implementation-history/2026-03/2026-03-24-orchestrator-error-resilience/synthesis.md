# Synthesis Report — Orchestrator Error Resilience
**Plan:** 2026-03-24-orchestrator-error-resilience  
**Date:** 2026-03-24  
**Status:** COMPLETE  
**Work Packages:** 3 / 3 COMPLETE  

---

## Executive Summary

This session hardened the orchestrator's MCP tool-call safety net and tightened the developer agent's prompt to prevent two classes of runtime errors observed in the 2026-03-24 orchestrator run.

**Root cause #1 (`ledger_detect_project` → `cwd_path` required schema error):** The `inject_project_path()` wrapper in `tool_wrappers.py` was stripping `cwd_path` without re-injecting it. Since `ledger_detect_project` only accepts `cwd_path` (not `project_path`), every call to that tool was arriving with neither parameter, causing a Zod schema validation failure. The fix switches to **dual injection**: `project_path` uses `setdefault` semantics (preserves explicit caller values) while `cwd_path` is always force-set to the authoritative project path. Because Zod silently strips unknown keys, tools that don't accept `cwd_path` are unaffected.

**Root cause #2 (`ledger_begin_work` → wrong pipeline type):** The developer user-turn prompt specified `project_path` and `wp_id` but omitted the pipeline type. The LLM inferred the type from the persona system prompt, but attention to user-turn content is stronger — it called `type="qa"` instead of `type="implementation"`. The fix explicitly adds `**Pipeline to start:** \`implementation\`` to the user-turn prompt, providing a per-invocation, unambiguous instruction.

A third WP (WP-003) updated the test suite to align with the new dual-injection semantics, replacing assertions that `cwd_path` is absent with assertions that `cwd_path == PROJECT`, and adding a comprehensive `TestDualInjection` class (10 tests) mapped directly to the WP-001 acceptance criteria.

---

## Work Packages

### WP-001 — Dual-injection in `tool_wrappers.py`
**File modified:** `orchestrator/src/utils/tool_wrappers.py`  
**Status:** COMPLETE — all 5 AC met  

| Criterion | Met |
|-----------|-----|
| Empty-dict call → both `project_path` and `cwd_path` injected | ✅ |
| Caller-supplied `cwd_path` is overwritten by authoritative value | ✅ |
| Explicit `project_path` is preserved (setdefault); `cwd_path` still force-set | ✅ |
| Behaviour consistent across flat-dict and ToolCall nested-dict structures | ✅ |
| Module docstring and inline comments reflect dual-injection semantics | ✅ |

**Key implementation details:**
- `project_path` uses `setdefault` (non-destructive); `cwd_path` is always assigned.
- Closure uses default-argument binding (`_orig=…, _proj=…`) — correct Python idiom for loop-variable capture.
- `object.__setattr__` bypass for Pydantic v2's `__setattr__` guard is correct and well-commented.

---

### WP-002 — Pipeline type in developer user prompt
**File modified:** `orchestrator/src/nodes/developer.py`  
**Status:** COMPLETE — all 4 AC met  

| Criterion | Met |
|-----------|-----|
| Prompt contains substring `'implementation'` | ✅ |
| `**Pipeline to start:** \`implementation\`` appears before the CRITICAL injection warning | ✅ |
| Module-level docstring updated to describe the new pipeline_type line | ✅ |
| Full test suite passes with no regressions | ✅ |

**Reviewer Fix-Forward applied:** Added explicit `assert 'implementation' in prompt` assertion to `test_developer_prompt_has_slim_fields` in `test_nodes.py`, making AC1 machine-verifiable via CI.

---

### WP-003 — Test suite alignment for dual-injection
**File modified:** `orchestrator/tests/test_tool_wrappers.py`  
**Status:** COMPLETE — all 5 AC met  

| Criterion | Met |
|-----------|-----|
| `test_cwd_path_stripped_...` updated: asserts `cwd_path == PROJECT` (not absent) | ✅ |
| `test_explicit_project_path_wins...` updated: also asserts `cwd_path == PROJECT` | ✅ |
| New test verifies empty call dict receives both `project_path` and `cwd_path` | ✅ |
| `test_toolcall_strips_cwd_path_from_args` updated to assert `cwd_path == PROJECT` | ✅ |
| `test_tool_wrappers.py` passes with zero failures | ✅ |

**Reviewer Fix-Forward applied:** Corrected stale `WP-005` docstring reference in `tool_wrappers.py` to `WP-001, WP-003` for traceability.

---

## Metrics

| Work Package | Tests Passed | Tests Failed | Pipeline |
|---|---|---|---|
| WP-001 (implementation) | 458 | 0 | ✅ PASS |
| WP-001 (QA) | 458 | 0 | ✅ PASS |
| WP-001 (code-review) | — | — | ✅ PASS |
| WP-002 (implementation) | 473 | 0 | ✅ PASS |
| WP-002 (QA) | 489 | 0 | ✅ PASS |
| WP-002 (code-review) | — | — | ✅ PASS |
| WP-003 (QA) | 31 | 0 | ✅ PASS |
| WP-003 (code-review) | 31 | 0 | ✅ PASS |

**Pipeline health:** 3/3 WPs with all stages PASS. 0 WPs missing stages.

**Known pre-existing issues (not caused by this session):**
- 9 `test_graph.py` failures due to missing `aiosqlite`/`langgraph.checkpoint.sqlite` modules in the sandbox environment.
- Pydantic v1 / Python 3.14 `FieldInfo` deprecation warnings from `langchain_core` — environment-level, unrelated to changes made.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Belt-and-Suspenders Approach to MCP Parameter Injection (High Value)
The dual-injection fix (`project_path` + `cwd_path`) eliminates an entire class of schema validation errors. The insight — that injecting both parameters into every tool call is safe because Zod silently strips unknown keys — is a reusable pattern. Any future MCP tools added to the schema that accept only `cwd_path` (or only `project_path`) will work correctly without requiring additional wrapper changes.

**Recommendation:** Apply this dual-injection principle proactively to any new path-based parameters that MCP tools may adopt in future.

### 2. User-Turn vs. System-Prompt Attention Gap (Architectural Insight)
The developer agent ignored the system prompt's `implementation` instruction and hallucinated `qa`. This is a well-known LLM behaviour: user-turn content receives more attention than system-prompt boilerplate. The fix (repeat key instructions in the user turn) is correct, but the broader principle warrants review:

**Recommendation:** Audit all agent personas for instructions that are safety-critical (wrong choice = hard failure) and verify each appears explicitly in the **user-turn prompt**, not only in the system prompt.

### 3. Explicit Assertions Over Visual Inspection in Tests
Two QA comments flagged AC criteria verified only by "visual inspection" (`'implementation' in prompt`). The Reviewer applied fix-forwards upgrading these to explicit assertions. This pattern recurred across two WPs.

**Recommendation:** Adopt a test-writing standard: acceptance criteria phrased as "X contains Y" or "X appears before Z" must have corresponding explicit assertions in the test suite, not just descriptive test names.

### 4. Stale WP References in Documentation (Low-Level but Recurring)
Two fix-forward items corrected stale WP references in docstrings (`WP-005` → `WP-001, WP-003`). These indicate the documentation practices when modifying existing files are insufficient.

**Recommendation:** Add a documentation checklist item — when modifying an existing file that contains WP references in comments or docstrings, update those references to include the current WP.

### 5. ToolCall Detection Heuristic is Informal (Low Risk, Worth Documenting)
The ToolCall branch is detected by `'args' in input and isinstance(input['args'], dict)`. As noted in code review, this could theoretically misfire on a flat-dict call containing a key named `'args'` with a dict value. No real MCP tool argument is named `'args'`, making this safe in practice — but the assumption is implicit.

**Recommendation:** Add a one-line comment at the heuristic site acknowledging this constraint, so future contributors do not inadvertently introduce a tool argument named `'args'` that triggers the wrong injection branch.

---

## Deferred / Documentation-Forward Items

These items were flagged during code review but are not blocking. They should be addressed in a follow-up session:

| Item | Location | Priority |
|---|---|---|
| Add test for `list`/`tuple` non-dict passthrough to harden the `isinstance(input, dict)` guard | `test_tool_wrappers.py` | Low |
| Add comment on ToolCall heuristic line acknowledging the `'args'` key assumption | `tool_wrappers.py` ~line 89 | Low |
| Update `TestInjectsWhenAbsent` section header and `test_empty_dict_receives_project_path` docstring to mention `cwd_path` co-injection | `test_tool_wrappers.py` ~line 77 | Low |
| Update `Context` section in `tool_wrappers.py` docstring (~line 31) to reference `WP-001` alongside the existing history | `tool_wrappers.py` | Low |

---

## Next Steps for Planner / Manager

1. **Monitor the next orchestrator run** to confirm `ledger_detect_project` and `ledger_begin_work` no longer produce errors with the dual-injection and prompt fixes in place.
2. **Address the deferred documentation-forward items** in a housekeeping WP (low urgency — all are cosmetic/documentation).
3. **Apply the user-turn attention audit** (Gold Nugget #2) to other agent personas that have safety-critical pipeline-type or parameter choices, particularly the QA and Reviewer nodes.
4. **Resolve the `test_graph.py` environment issues** (`aiosqlite`/`langgraph.checkpoint.sqlite` missing) in a separate infrastructure WP to restore full test suite coverage.
