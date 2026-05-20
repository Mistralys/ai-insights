# Project Synthesis Report

**Plan:** `2026-05-20-orchestrator-gui-polish-rework`
**Date:** 2026-05-20
**Status:** COMPLETE
**Work Packages:** 6 / 6 COMPLETE — all pipeline stages PASS

---

## Executive Summary

This sprint closed six actionable items identified in the previous `2026-05-19-orchestrator-gui-polish` sprint synthesis. All changes targeted the MCP server GUI layer and were purely additive or structural — no public APIs, CLI surfaces, or user-facing behaviours changed.

| # | Item | Scope |
|---|------|-------|
| 1 | Banner-clearing test coverage — 3 dedicated unit tests for `renderQueueTable` banner lifecycle | Test |
| 2 | `makeEntry()` type safety — converted from `Record<string,unknown>` to `Partial<QueueEntry>` | Test infra |
| 3 | `orchestrator-widgets.test.ts` header comment fix — `"appends"` → `"prepends (most-recent-first)"` | Comment |
| 4 | `statusPollTimer` cleanup — registered interval ID in `_orchLogPreviewCleanups` | Bug fix / memory |
| 5 | `renderQueueTable` extraction — three closure-scoped helpers + coordinating shell | Refactor |
| 6 | `isRawQueueEntry` validator tightening — empty-string guard on `expectedSlug` | Hardening |

All six items shipped with zero regressions across the full 2,205-test suite.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work packages | 6 / 6 COMPLETE |
| Pipeline stages per WP | 4 (implementation → qa → code-review → documentation) |
| WPs with all stages PASS | 6 / 6 |
| Total rework cycles | 0 |
| Tests at start of sprint | ~2,202 |
| Tests at end of sprint | **2,205** (+3 new banner-clearing tests) |
| Tests failed | **0** |
| TypeScript compile (`tsc --noEmit`) | **PASS** |
| Test files | 73 |
| Documented documentation-forward items resolved | 5 |
| Blocker / security issues | None |

---

## Work Package Outcomes

### WP-001 — Banner-clearing test coverage
Three new tests in a dedicated `describe('renderOrchestrator — banner clearing')` block in `orchestrator-view.test.ts`. Tests exercise: (1) `.success-banner` removed on non-empty queue render; (2) `.error-banner` preserved on non-empty queue render; (3) `.success-banner` intact when queue returns empty. The `flushPromises()` JSDoc was expanded to document the 10-iteration loop rationale for multi-hop promise chains.

**Files changed:** `mcp-server/tests/gui/orchestrator-view.test.ts`

### WP-002 — Sprint-batch implementation (5 sub-items)
This WP served as the sprint implementation hub covering all five remaining non-test items: `statusPollTimer` cleanup registration, `orchestrator-widgets.test.ts` comment fix, `isRawQueueEntry` empty-slug guard, `makeEntry()` type-safety conversion, and the `renderQueueTable` four-helper refactor. JSDoc was added to all extracted closure-scoped helpers documenting their read-only vs. mutated closed-over variables.

**Files changed:** `mcp-server/gui/public/views/orchestrator.js`, `mcp-server/src/gui/queue/get-queue.ts`, `mcp-server/tests/gui/orchestrator-view.test.ts`, `mcp-server/tests/gui/orchestrator-widgets.test.ts`, `mcp-server/tests/gui/queue/get-queue.test.ts`, `mcp-server/docs/agents/project-manifest/api-surface.md`

### WP-003 — `isRawQueueEntry` empty-slug guard (standalone verification)
Standalone verification WP confirming the `(e['expectedSlug'] as string).length > 0` guard and its accompanying test and `api-surface.md` documentation were all correctly in place. JSDoc was added to the previously undocumented `isRawQueueEntry()` function, listing all 5 validation rules.

**Files changed:** `mcp-server/src/gui/queue/get-queue.ts`

### WP-004 — `orchestrator-widgets.test.ts` comment fix (standalone verification)
Standalone verification confirming the AC-4 header comment on line 14 already reads the required text. No code change needed. Pipeline completed cleanly.

**Files changed:** `mcp-server/tests/gui/orchestrator-widgets.test.ts` (already correct)

### WP-005 — `makeEntry()` type safety (standalone verification)
Standalone verification that the `Partial<QueueEntry>` factory signature, `import type { QueueEntry }`, and `status: 'pending' as const` were all in place from WP-001. QA added a negative compile-time test confirming that mistyped fields produce `TS2353` as expected. The stale `— WP-011` reference in the test file header was removed.

**Files changed:** `mcp-server/tests/gui/orchestrator-view.test.ts`

### WP-006 — `renderQueueTable` extraction (standalone verification)
Standalone verification of the four-helper refactor: `_clearSuccessBanner` (6L), `_buildQueueHtml` (45L), `_bindQueueActions` (34L), `_mountLogPreviews` (13L) — all ≤ 50 lines. `renderQueueTable` coordinator = 20 lines (≤ 30). One trailing comma was removed by the Reviewer (non-behavioral ES5 style fix). Documentation updated `orchestrator.js` file header, `file-tree.md`, and `changelog.md` (v1.30.3 entry). CTX context regenerated (32 documents).

**Files changed:** `mcp-server/gui/public/views/orchestrator.js`, `mcp-server/docs/agents/project-manifest/file-tree.md`, `mcp-server/changelog.md`

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Whitespace-only slug validation gap (low priority)
QA identified that `isRawQueueEntry()`'s empty-string guard uses `length > 0`, which allows whitespace-only slugs (e.g. `'   '`). A slug of all spaces would pass validation but silently fail downstream ledger lookups. **Recommendation:** Change to `.trim().length > 0`.

### 2. `statusPollTimer` dual-cancel is correct but fragile for future changes
The timer self-cancels inside its own callback (when status resolves or `MAX_STATUS_POLLS` is reached) AND is also registered in `_orchLogPreviewCleanups` as a safety net. A secondary concern was noted: `refreshQueue()` also drains `_orchLogPreviewCleanups` directly (lines 180–181), meaning the timer could be cleared prematurely if a queue poll fires before the status poll resolves. This is pre-existing behaviour. **Recommendation:** Consider splitting `_orchLogPreviewCleanups` into separate arrays for log-preview cleanups vs. status-poll cleanups to avoid cross-cancellation.

### 3. `isRawQueueEntry()` is private but untestable directly
The validator is a module-private function tested only indirectly via `getQueue()`. With 5 validation rules now documented, targeted unit tests against it directly would be faster and more precise. **Recommendation:** Export the function (or move to a dedicated `validators.ts` module) to enable direct unit testing.

### 4. Closure-dependency pattern documented — extend to future helpers
The JSDoc convention for documenting read-only vs. mutated closed-over variables on `_bindQueueActions()` and `_mountLogPreviews()` (added this sprint) is now a good precedent. **Recommendation:** Adopt this as a formal convention for all future closure-scoped helpers added to `orchestrator.js`, and mention it in `AGENTS.md` or the project manifest.

### 5. `flushPromises()` loop count should be reviewed if async chains grow
The 10-iteration `Promise.resolve()` loop was empirically chosen. As the test suite grows, longer async chains (more than 10 hops) could silently cause flaky tests. **Recommendation:** Replace with `vi.runAllTimers()` or a proper `flushAllMicrotasks()` utility from a testing library when the suite next requires async infrastructure improvements.

---

## Failing / Blocked Items

None. All 6 WPs completed with PASS on all pipeline stages. No blockers were raised at any point during the sprint.

---

## Next Steps for Planner / Manager

1. **Address the whitespace slug gap** — one-line change to `isRawQueueEntry()` (`.trim().length > 0`), add a test for `'   '` slug input. Small WP, no dependencies.
2. **Split `_orchLogPreviewCleanups`** — evaluate whether premature cleanup of `statusPollTimer` during `refreshQueue()` is a real observed bug; if so, separate the cleanup registries.
3. **Export / unit-test `isRawQueueEntry()` directly** — consider moving to a `validators.ts` module to enable targeted testing as the rule count grows.
4. **Codify the JSDoc closure-dependency convention** — add a one-paragraph note to `AGENTS.md` or `CONVENTIONS.md` so all future GUI contributors follow the pattern without needing to discover it from existing code.
5. **Plan next `orchestrator.js` complexity audit** — with `renderQueueTable` now a clean coordinator, consider whether `renderOrchestrator()` itself has grown beyond a comfortable complexity threshold and whether the Start Run handler should be extracted similarly.
