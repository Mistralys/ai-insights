# Synthesis Report

**Plan:** `2026-02-20-strategic-recommendations`  
**Date:** 2026-02-20  
**Status:** COMPLETE  
**Work Packages:** 5 / 5 COMPLETE  

---

## Executive Summary

This session implemented all five strategic recommendations surfaced during the `2026-02-20-gold-nuggets-housekeeping` session. None were defect fixes — the baseline was already 251/251 passing tests with a clean `tsc --noEmit`. The work delivers four concrete improvements across four distinct quality dimensions:

1. **Type safety hardening** — `noUncheckedIndexedAccess: true` enabled in `tsconfig.json`, closing the compiler's blind spot on string-indexed record accesses codebase-wide.
2. **Structural drift prevention** — The manual 18-entry `_internal` synchronisation object in `workflow.ts` replaced with individual named exports + namespace import in tests, making it self-maintaining.
3. **Script robustness** — `check-known-roles.js` silently-failing regex path replaced with a `parseArray` helper using the dotAll flag and `process.exit(1)` on parse failure.
4. **Test hygiene** — Inline `stderrSpy` setup/teardown in `agent-registry.test.ts` migrated to `beforeEach`/`afterEach` hooks across all 5 affected describe blocks; `discoverAgents` `@param strict` JSDoc added to anchor the CI/validation contract.

12 source files modified. Test count held at 251/251 throughout. `tsc --noEmit` clean at all stages.

---

## Metrics

| WP | Title | Score | Rework | Tests |
|----|-------|:-----:|:------:|------:|
| WP-001 | Enable `noUncheckedIndexedAccess` | 9/10 | 0 | 251/251 |
| WP-002 | Eliminate manual `_internal` list | 9/10 | 0 | 251/251 |
| WP-003 | Harden `check-known-roles.js` | 9/10 | 0 | — (script test) |
| WP-004 | Migrate stderr spy lifecycle | 8/10 | **1** | 251/251 |
| WP-005 | Add `@param strict` JSDoc | 10/10 | 0 | — (docs-only) |

**Average implementation score:** 9.0 / 10  
**Total rework cycles:** 1  
**Security issues:** 0  
**Critical issues found in review:** 0  
**Total review suggestions:** 6 (all non-blocking, low priority)

### Files Modified

| File | WP(s) |
|------|-------|
| `mcp-server/tsconfig.json` | WP-001 |
| `mcp-server/src/index.ts` | WP-001 |
| `mcp-server/src/tools/workflow.ts` | WP-001, WP-002 |
| `mcp-server/src/utils/agent-registry.ts` | WP-001, WP-005 |
| `mcp-server/src/utils/wp-id.ts` | WP-001 |
| `mcp-server/tests/tools/workflow-handoff.test.ts` | WP-002 |
| `mcp-server/tests/integration/auto-handoff.test.ts` | WP-002 |
| `mcp-server/tests/utils/agent-registry.test.ts` | WP-004 |
| `scripts/check-known-roles.js` | WP-003 |
| `mcp-server/changelog.md` | WP-001–005 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-002 |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | WP-001 |

---

## Quality Observations

### WP-004 Rework Cycle

The single rework in this session occurred on WP-004. The initial implementation correctly migrated 3 of the 5 describe blocks in `agent-registry.test.ts` but left two inline `const stderrSpy` declarations inside `it` bodies within the `AC: role collision warning` describe block (lines 441 and 478). QA's FAIL caught this precisely. QA applied the fix directly and the second pass was PASS. The resulting code is indistinguishable from a single-pass correct implementation. The root cause was likely incomplete coverage of the fifth describe block during the first pass.

### ESM Self-Export Limitation (WP-002)

The plan specified `export * as _internal from './workflow.js'` as the replacement for the manual `_internal` object. This form is not valid in ESM (self-referential circular re-export). The Developer correctly identified this at implementation time and substituted the idiomatic alternative: export each formerly-private function individually and use `import * as _internal from workflow.js` in tests. This is a better outcome — the namespace import in tests naturally stays in sync with any new exports added to the source file, without requiring any test-side changes.

---

## Gold Nuggets (Strategic Recommendations for Next Cycle)

### GN-1 — Follow-on `_internal` migration for `pipeline.ts` and `work-package.ts` _(priority: medium)_

The WP-002 refactor was correctly scoped to `workflow.ts` only. Both `mcp-server/src/tools/pipeline.ts` and `mcp-server/src/tools/work-package.ts` still use the old `export const _internal = { ... }` manual-object pattern. Their respective test files (`pipeline.test.ts`, `work-package.test.ts`) consume `_internal` via named destructuring. The same treatment applied in WP-002 would eliminate the drift risk in those two modules. Each is a near-identical one-WP change.

> **Planner action:** Create a follow-on plan with two WPs — one per module — using WP-002 as the template.

### GN-2 — Stale-dist false-negative risk in `check-known-roles.js` _(priority: medium)_

`check-known-roles.js` reads `AGENT_ROLES` from `mcp-server/dist/` and requires a prior `npm run build`. If `dist` is stale, the script produces false-negative diff results without any indication that the comparison baseline is outdated. The fix is a pre-step that calls `tsc --noEmit && npm run build` before the role comparison. The existing file header documents this limitation but does not enforce it.

> **Planner action:** Add a pre-build step to `check-known-roles.js` (or the `check:roles` npm script) that ensures `dist` is fresh before comparison.

### GN-3 — Unreachability comments on `noUncheckedIndexedAccess` guards _(priority: low)_

Two guard sites added in WP-001 are technically unreachable — the regex capture groups always produce a value when the outer match succeeds — but are required by the compiler flag. `workflow.ts` correctly carries an inline comment explaining this. The equivalent comments are missing from `agent-registry.ts` (lines 41–43, 50–52) and `wp-id.ts` (lines 21–24). Both Reviewer and Developer flagged this; adding the comments is a single-pass, low-risk cleanup.

> **Developer action:** Add `// Unreachable: regex (.+|\\d+) always captures when match succeeds; satisfies noUncheckedIndexedAccess` to the two affected sites.

### GN-4 — Duplicate module specifier in `workflow.ts` re-export _(priority: low)_

`workflow.ts` line 39 re-exports `PIPELINE_AGENT_MAP` and `NEXT_AGENT_MAP` via a full `from '../utils/pipeline-maps.js'` re-export statement, while lines 10–11 already import those same names. The cleaner form is `export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP };` — re-exporting the already-imported bindings — which removes the duplicate module specifier. Functionally identical; purely a style improvement.

> **Developer action:** Replace line 39 in `workflow.ts` with `export { PIPELINE_AGENT_MAP, NEXT_AGENT_MAP };`.

### GN-5 — `ifDefined` helper for array-element narrowing _(priority: low)_

The `const [firstBlocked] = blockedWps` + `if (firstBlocked === undefined)` pattern introduced in `workflow.ts` (WP-001) is idiomatic but verbose if it accumulates across the codebase. A generic `ifDefined<T>(value: T | undefined, fn: (v: T) => void): void` utility in `src/utils/` would centralise this intent. Track for future addition if similar guards appear in two or more additional locations.

---

## Next Steps (Planner Queue)

1. **Immediate (medium priority):** Create a two-WP follow-on plan to migrate `pipeline.ts` and `work-package.ts` from the `_internal` manual-object pattern to the namespace import approach (GN-1).
2. **Near-term (medium priority):** Add a pre-build step to the `check:roles` script to eliminate stale-dist false negatives (GN-2).
3. **Opportunistic (low priority):** Add unreachability comments to `agent-registry.ts` and `wp-id.ts` guard sites in the next session touching those files (GN-3).
4. **Opportunistic (low priority):** Clean up the duplicate module specifier in `workflow.ts` line 39 (GN-4).
5. **Watch (low priority):** Track `ifDefined` utility need — act if the pattern appears in two or more additional locations (GN-5).
