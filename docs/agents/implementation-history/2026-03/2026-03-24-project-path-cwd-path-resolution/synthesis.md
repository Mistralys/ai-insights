# Project Synthesis Report
## Eliminate `project_path` / `cwd_path` Confusion Permanently

**Project:** `2026-03-24-project-path-cwd-path-resolution`
**Report Date:** 2026-03-25
**Status at Close:** COMPLETE — all 5 work packages passed all pipeline stages

---

## Executive Summary

This project eliminated a class of runtime failures caused by agents (LLM-driven and orchestrator-automated) passing both `project_path` and `cwd_path` to MCP tools simultaneously. The root cause was a strict mutual-exclusivity guard in `resolveProjectPath()` that rejected calls with both parameters, combined with tool schema descriptions that gave contradictory guidance about which parameter to prefer.

The solution applied a three-layer fix:

1. **Server logic (WP-003):** Replaced the mutual-exclusivity throw in `resolveProjectPath()` with a deterministic precedence rule — when both parameters are supplied, `project_path` wins and `cwd_path` is silently ignored.
2. **Schema descriptions (WP-001):** Updated all 36 `.describe()` annotations across 7 tool files to clearly state the precedence contract.
3. **Help content and constraints (WP-002):** Rewrote `help-content.ts` parameter descriptions (16 per-tool + overview paragraph) and reframed Constraint 57 in `constraints.md` from "mutual exclusivity error" to "project_path-wins precedence rule".
4. **Orchestrator documentation (WP-004):** Updated the module docstring in `tool_wrappers.py` to reflect the new graceful-handling behaviour (belt-and-suspenders approach retained, no longer masking a hard error).

The change is fully backward-compatible: no parameters removed, no schema changes, no breaking changes for any consumer. Agents that were previously failing with mutual-exclusivity rejections will now succeed without any modifications on their end.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages completed | 5 / 5 |
| Pipeline stages passed | 12 / 12 |
| mcp-server vitest tests (final) | **1700 / 1700** (exit code 0) |
| orchestrator pytest tests | **49 / 49** (exit code 0) |
| Regressions introduced | **0** |
| TypeScript compilation | Clean |
| Files modified | 10 (7 tool schemas, path-validator, 2 test files, help-content.ts, constraints.md, tool_wrappers.py) |

### WP Pipeline Summary

| WP | Title | Stages | Result |
|----|-------|--------|--------|
| WP-001 | Update `.describe()` annotations in 7 tool files | implementation → code-review | PASS |
| WP-002 | Rewrite help-content.ts and constraints.md | implementation → documentation | PASS |
| WP-003 | Replace mutual-exclusivity guard with precedence rule | implementation → qa → code-review | PASS |
| WP-004 | Update `tool_wrappers.py` module docstring | implementation → documentation | PASS |
| WP-005 | Integration QA across all changes | qa | PASS |

---

## What Was Changed

### Core Logic Change (`path-validator.ts`)

- **Before:** `resolveProjectPath()` threw `MUTUAL_EXCLUSIVITY_PATH_MSG` when both `project_path` and `cwd_path` were provided.
- **After:** When both are provided, `project_path` is returned immediately. `cwd_path` is ignored. `detectProjectByCwd()` is never called.
- **Removed exports:** `MUTUAL_EXCLUSIVITY_PATH_MSG` constant and `mutuallyExclusivePaths` helper — both were dead after the guard removal. The public API surface of `path-validator.ts` now exports exactly 4 symbols.

### Schema Descriptions (7 tool files)

All 18 `project_path` annotations now carry: *"Absolute path to the plan folder. Use this if you already have it from a previous tool response or if it was provided in your instructions. Takes precedence over cwd_path if both are given."*

All 18 `cwd_path` annotations now carry: *"Your current workspace root directory. The server auto-detects the active project. Ignored if project_path is also provided."*

### Help Content and Constraints

- `help-content.ts` overview paragraph and all 16 per-tool parameter blocks updated to document the precedence rule instead of mutual exclusivity.
- Constraint 57 in `mcp-server/docs/agents/project-manifest/constraints.md` retitled and rewritten with a 3-step precedence rule, caller guidance, and anti-pattern/correct-pattern examples.

### Orchestrator Documentation

- `tool_wrappers.py` module docstring updated: the `cwd_path` stripping rationale now reads *"strips it for efficiency — the MCP server now handles both gracefully (project_path takes precedence), but stripping avoids sending redundant data."*

### Test Suite Updates

- `path-validator.test.ts`: removed the `throws when both project_path and cwd_path are provided` test; added `uses project_path when both project_path and cwd_path are provided` test with a `detectProjectByCwd` spy asserting NOT called.
- `workflow-next-action.test.ts`: replaced the `returns an error when both project_path and cwd_path are provided` test with an integration test confirming `CLAIM_WP` is returned (no error) when both params are supplied.

---

## Strategic Recommendations

### High Priority — Future Work Items

None identified at high priority. The core problem is fully resolved.

### Medium Priority

**1. Synchronise `constraints.md` across sub-projects**
*(Raised by Documentation agent, WP-002)*
`mcp-server/docs/agents/project-manifest/constraints.md` has been updated (Constraint 57 rewritten), but `orchestrator/docs/agents/project-manifest/constraints.md` and `personas/docs/agents/project-manifest/constraints.md` appear to be manually-maintained copies. A sync pass should propagate the Constraint 57 rewrite (or a note that the rule applies server-side, not to those sub-projects) so agents reading those files get consistent guidance.

### Low Priority — Housekeeping / Tech Debt

**2. Extract shared `cwd_path`/`project_path` parameter descriptions in `help-content.ts`**
*(Raised by Developer and Documentation agents, WP-002)*
The 16 per-tool parameter descriptions are currently verbatim repeats. Extracting them to a shared constant would prevent drift when wording needs updating again. The bulk-replace approach used in this project mitigates risk but is brittle.

**3. Add third resolution-rule bullet to `resolveProjectPath()` JSDoc**
*(Raised by QA, Reviewer, WP-003)*
The JSDoc on `resolveProjectPath()` in `path-validator.ts` documents two resolution rules but the third (*"Both provided → project_path wins, cwd_path ignored"*) lives only as an inline code comment. A third JSDoc bullet would make the API contract fully self-documenting at the signature level.

**4. Update inline comment in `tool_wrappers.py` `_wrapped_ainvoke`**
*(Raised by Developer and Documentation agents, WP-004)*
The inline comment inside `_wrapped_ainvoke` (lines ~113–118) still reads *"remove it — most MCP tools enforce mutual exclusivity between project_path and cwd_path."* This is now incorrect. A micro-task should update this comment to align with the new graceful-handling framing in the module docstring.

**5. Track pre-existing GUI test failures in a dedicated work package**
*(Raised by Developer, QA, WP-003 and WP-005)*
`tests/gui/api.test.ts` (2 failures) and `tests/gui/dialogue-qa.test.ts` (12 failures) were pre-existing at project start and unrelated to this project's scope. These were independently fixed between WP-005's first and second QA runs, confirming they were live regressions in the main branch. A dedicated work package should review and hardened those GUI test suites to prevent recurrence.

---

## Next Steps for the Planner / Manager

1. **Ship this change** — the MCP server build is clean, all 1700 tests pass, and the behavioural change is backward-compatible. No release blockers remain.
2. **Consider a patch-level version bump** for `mcp-server` — the API surface changed (two symbols removed, behaviour changed from throw to precedence) and the help-content strings changed. Persona files that embed parameter descriptions may need regeneration after the version bump.
3. **Regenerate `.context/` docs** (`node scripts/cli.js ctx-generate`) so the codebase snapshots reflect the updated tool schemas, constraints, and orchestrator docstring.
4. **Open a follow-on micro-task** for items 2–4 in the Recommendations section above (shared constant refactor, JSDoc 3rd bullet, inline comment fix). These are low-effort polish items that improve long-term maintainability.
5. **Constraints.md sync** (item 1 above) is worth a dedicated check — determine whether the orchestrator/personas copies of `constraints.md` need a corresponding note, or whether a single authoritative copy with references would serve better.
