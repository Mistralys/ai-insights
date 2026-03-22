# Project Synthesis Report

**Project:** `2026-03-05-zod-refine-empty-schema`
**Date:** 2026-03-05
**Status:** COMPLETE
**Work Packages:** 5 / 5 COMPLETE
**Synthesised By:** Head of Operations (Synthesis Agent)

---

## Executive Summary

This session fixed a silent but critical bug: Zod `.refine()` calls on the outer `z.object()` wrapper of tool schemas were converting them from `ZodObject` to `ZodEffects`, causing the MCP SDK to generate an empty `inputSchema.properties` object in `tools/list` responses. Callers received tools with no visible parameters — a complete schema blackout.

The fix was delivered in a clean four-stage plan:

1. **WP-001** — Added a runtime mutual exclusivity guard in `resolveProjectPath()`: when both `project_path` and `cwd_path` are supplied, the function now throws `Error(MUTUAL_EXCLUSIVITY_PATH_MSG)` immediately, replacing the prior silent preference.
2. **WP-002** — Removed all 18 `.refine(mutuallyExclusivePaths, …)` chains from 7 tool files, restoring all schemas to plain `ZodObject` instances and fixing the empty-properties bug.
3. **WP-003** — Created `tests/tools/schema-integrity.test.ts`: a 24-test permanent regression guard that captures all 22 tool schemas at registration time and asserts non-empty `properties` via `zodToJsonSchema`.
4. **WP-004** — Documented the rule as Constraint §63 (no `.refine/.transform/.superRefine` on outer tool schemas), added §64 (mock `McpServer` intercept testing pattern), and added a `See also §63` cross-reference in §57.
5. **WP-005** — End-to-end verification pass: 1038/1038 tests, `tsc --noEmit` exits 0, all 22 tool schemas confirmed non-empty.

All 20 pipelines (implementation → QA → code-review → documentation per WP) passed with `PASS` status. Zero regressions.

---

## Metrics

| Metric | Start (WP-001) | End (WP-005) | Delta |
|---|---|---|---|
| Tests passing | 1014 | 1038 | +24 |
| Tests failing | 0 | 0 | — |
| TypeScript errors | 0 | 0 | — |
| Schemas with empty properties | 18 | 0 | −18 |
| Tool files with `.refine()` imports | 7 | 0 | −7 |
| New constraints added | — | 2 (§63, §64) | +2 |
| Pipeline failures | 0 | — | — |
| Rework cycles | 0 | — | — |

---

## Failures & Blockers

**None.** All 20 pipelines returned `PASS` on first attempt. No rework cycles, no blocked work packages.

---

## Strategic Recommendations (Gold Nuggets)

### 1. Add `@deprecated` JSDoc to dead exports — Priority: Low

`mutuallyExclusivePaths` and `MUTUAL_EXCLUSIVITY_PATH_MSG` in `mcp-server/src/utils/path-validator.ts` are no longer imported by any production tool file. They are test-only dead code retained for backward compatibility. Adding `@deprecated` JSDoc to both exports costs nothing and makes their transitional status explicit to future contributors.

> Flagged independently by: Developer (WP-002), Reviewer (WP-002), Reviewer (WP-005).

### 2. Add `zod-to-json-schema` as an explicit `devDependency` — Priority: Low (but recurring)

`schema-integrity.test.ts` imports `zod-to-json-schema` directly, but it is only present as a transitive dependency of `@modelcontextprotocol/sdk`. If the SDK drops it in a future release, the entire schema regression guard breaks at import with a non-obvious error. Pinning `"zod-to-json-schema": "*"` (or the current resolved version) under `devDependencies` in `mcp-server/package.json` eliminates this fragility.

> Flagged independently by: Developer (WP-003), QA (WP-003), Reviewer (WP-003), Reviewer (WP-005) — four agents, three work packages.

### 3. Mock `McpServer` intercept pattern is reusable (now codified in §64)

The approach used in `schema-integrity.test.ts` — capturing `inputSchema` at `register()` time via a `Map`, without spinning up a real server — is a zero-overhead pattern usable for any future test that needs to inspect tool metadata (descriptions, parameter constraints, enum values). Constraint §64 documents this pattern with a full code example for future agents/contributors.

### 4. §57 and §63 overlap is intentional — future cross-referencing done

§57 (mutual exclusivity path enforcement) and §63 (general ZodEffects prohibition) share substantive rationale. The Documentation agent added a `See also §63` forward-reference in §57 as part of WP-004, ensuring discoverability without removing any content.

### 5. Consider auditing other tool test files for stale `{project_path, cwd_path}` both-provided tests

The Developer note from WP-001 identified that `workflow-next-action.test.ts` had a test documenting the old silent-preference behavior; this was corrected. Other test files (`pipeline.test.ts`, `work-package.test.ts`, etc.) may contain similar stale tests. A targeted grep for `cwd_path` in test files alongside `project_path` would confirm whether further cleanup is needed.

---

## Artifacts Modified

| File | Changed By |
|---|---|
| `mcp-server/src/utils/path-validator.ts` | WP-001 |
| `mcp-server/tests/utils/path-validator.test.ts` | WP-001 |
| `mcp-server/tests/tools/workflow-next-action.test.ts` | WP-001 |
| `mcp-server/src/tools/begin-work.ts` | WP-002 |
| `mcp-server/src/tools/workflow-next-action.ts` | WP-002 |
| `mcp-server/src/tools/workflow-handoff.ts` | WP-002 |
| `mcp-server/src/tools/observations.ts` | WP-002 |
| `mcp-server/src/tools/pipeline.ts` | WP-002 |
| `mcp-server/src/tools/project-lifecycle.ts` | WP-002 |
| `mcp-server/src/tools/work-package.ts` | WP-002 |
| `mcp-server/tests/tools/schema-integrity.test.ts` | WP-003 (new file) |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-001, WP-002, WP-003, WP-004 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-001, WP-002 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-003 |
| `mcp-server/changelog.md` | WP-005 |

---

## Next Steps for Planner / Project Manager

1. **Immediate (low effort):** Add `@deprecated` JSDoc to `mutuallyExclusivePaths` and `MUTUAL_EXCLUSIVITY_PATH_MSG` in `path-validator.ts`. Single-file, no tests needed.
2. **Immediate (low effort):** Add `zod-to-json-schema` as an explicit `devDependency` in `mcp-server/package.json`. Single-line change.
3. **Optional audit:** Grep `mcp-server/tests/tools/` for test cases that pass both `project_path` and `cwd_path` without expecting an error — these may be residual stale tests from the old silent-preference behavior. `workflow-next-action.test.ts` was already fixed; others may remain.
4. **Version release:** `mcp-server/changelog.md` has been updated with a `v1.9.1` entry for this bug fix. Run `npm run sync-version` in `mcp-server/` to propagate to `package.json` if not already done.
