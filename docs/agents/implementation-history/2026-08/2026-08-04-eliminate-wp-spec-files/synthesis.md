# Synthesis Report — Eliminate WP Spec Files

**Project:** 2026-08-04-eliminate-wp-spec-files  
**Date:** 2026-08-04  
**Status:** COMPLETE — 6/6 WPs completed, all 4 pipeline stages passed

---

## Executive Summary

This project eliminated the redundant `work/WP-###.md` spec files and `work.md` summary index from the ledger workflow across the entire ai-insights codebase. The `work_package_file` field was removed from all MCP server schemas, tools, fixtures, and tests; `description` was promoted to a required field in `CreateWorkPackageSchema`; and all agent personas (Bootstrapper, PM, Developer, QA, Security Auditor, Reviewer, Release Engineer, Documentation, Synthesis) were updated to use `ledger_get_work_package` as the sole source of WP specification content. The workflow now has a true single source of truth: the ledger. No spec files are created, no AC fidelity cross-checks are needed, and agents no longer pay the token cost of a redundant file read alongside a tool call.

**Scope of change:**
- ~50 files modified across MCP server source, tests, persona sources, workflow-spec docs, generated context, and orchestrator test
- 4020 passing tests (+1 net new validation test)
- 126 persona files built with no staleness
- Zero `work_package_file` references remaining in `mcp-server/src/`, `mcp-server/tests/`, `personas/`, or `orchestrator/`

---

## Metrics

| WP | Implementation | QA Tests Passed | Code Review | Documentation |
|----|---------------|-----------------|-------------|---------------|
| WP-001 | PASS | 4019 / 4019 | PASS | PASS |
| WP-002 | PASS | 4020 / 4020 (+1 new) | PASS | PASS |
| WP-003 | PASS | 0 (persona-only) | PASS | PASS |
| WP-004 | PASS | 0 (persona-only) | PASS | PASS |
| WP-005 | PASS | 0 (persona-only) | PASS | PASS |
| WP-006 | PASS | 0 (parse OK) | PASS | PASS |

**Total acceptance criteria:** 40 (all met)  
**Total pipeline stages completed:** 24 (6 WPs × 4 stages)  
**Regressions introduced:** 0  
**Build status:** TypeScript typecheck clean; `npm run build` success; persona build 126 files no staleness

---

## Strategic Recommendations

### 1. The schema input/storage asymmetry is intentional — document it prominently
`description` is required in `CreateWorkPackageSchema` (input) but remains `z.string().optional()` in `WorkPackageDetailSchema` (storage). This is correct: existing stored JSON files predating this change may lack the field. The asymmetry is permanent and agents reading the code without context may flag it as a bug. A brief inline comment in `work-package.ts` noting this intent would prevent repeated re-investigation.

### 2. Token savings are substantial and compound
The plan estimated 500–2,000 tokens saved per WP per agent invocation. For a 5-WP project with 7 agents, this is ~17,500–70,000 tokens per project run — before accounting for the Bootstrapper's eliminated N+1 file-write tool calls and the PM's eliminated AC fidelity verification round-trip. Projects with more WPs or longer spec bodies realize proportionally larger savings. This is a high-leverage architectural change.

### 3. Bootstrapper `description` parameter now needs a brevity guide
With spec files gone, the `description` body passed to `ledger_create_work_package` is the only written artifact for WP specifications. The Bootstrapper currently has no word-limit guidance on the `description` field. Agents may produce excessively long descriptions that inflate both ledger storage and future context windows. A recommended maximum (e.g. 500 words) or a brevity principle should be added to the Bootstrapper's Step 3 instructions.

### 4. The schema-replica test pattern needs a maintenance note
`work-package.test.ts` now has three schema-replica tests (`rejects missing title`, `rejects empty-string title`, `rejects missing description`) that duplicate production schema constraints as local `z.object()` definitions. If production constraints change, these replicas won't auto-fail. An inline comment in the `describe` block explaining the trade-off (Zod validation fires at the MCP SDK layer, preventing direct tool invocation for negative tests) and suggesting the replica should be kept in sync would prevent silent drift.

### 5. Pre-existing: `help-content.ts` lists `title` as Optional, but it is required
`CreateWorkPackageSchema` has `title: z.string().min(1)` without `.optional()`, yet `help-content.ts` lists it under Optional Parameters. This inconsistency predates this project (not introduced here) but will confuse agents reading tool introspection output. Either the schema should add `.optional()` (changing behavior) or the help text should move `title` to the Required list.

---

## Deferred & Follow-Up Items

| # | WP | Agent | Description | Priority | Type |
|---|-----|-------|-------------|----------|------|
| 1 | WP-001 | Developer | Add a regression test to `work-package-schema.test.ts` asserting `work_package_file` is **absent** from `WorkPackageDetailSchema` — no such negative assertion currently exists | low | deferred |
| 2 | WP-001 | Code Review | Pre-existing: `help-content.ts` lists `title` under Optional Parameters but `CreateWorkPackageSchema` makes it required (`z.string().min(1)`) — align schema or help text | medium | out-of-scope |
| 3 | WP-002 | Code Review | Add an inline note to the schema-replica test `describe` block explaining the pattern's fragility (replica won't catch production schema drift) and why direct tool invocation can't be used | low | deferred |
| 4 | WP-003 | Developer | Consider adding a word-limit or brevity guide to the Bootstrapper's `description` field instructions (e.g. "aim for < 500 words") to prevent token-bloating spec bodies | low | deferred |
| 5 | WP-005 | Code Review | Minor phrasing inconsistency across agent persona Inputs sections: QA (4-qa.md) names `acceptance_criteria` as a field explicitly; Security Auditor, Reviewer, Release Engineer say "acceptance criteria" in plain English — future standardization pass | low | deferred |

---

## Next Steps

1. **Planner:** No immediate follow-on project is required. This was a clean, self-contained refactor. The deferred items above are low-priority maintenance tasks that can be folded into the next relevant project touching these files.

2. **Consider:** A small follow-up plan to add the schema-absence regression test (item #1) and fix the `title` Optional/Required help-text inconsistency (item #2) — both are quick changes to `mcp-server/` that would close known documentation gaps.

3. **Monitor:** Observe whether agent sessions after this change produce excessively long `description` fields in `ledger_create_work_package` calls. If so, prioritize the brevity guide addition (item #4).

4. **Regenerate CTX docs** if any additional persona or workflow-spec changes are made outside this plan — `ctx-generate` was run during WP-002's documentation stage but may be stale if WP-003/WP-004 doc changes weren't included in that run.
