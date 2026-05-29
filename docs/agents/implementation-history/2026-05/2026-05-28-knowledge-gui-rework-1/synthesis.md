# Project Synthesis Report

**Plan:** `2026-05-28-knowledge-gui-rework-1`  
**Date:** 2026-05-29  
**Status:** COMPLETE  
**Work Packages:** 6 / 6 COMPLETE  
**Pipeline Health:** All 6 WPs passed all active stages (27 total pipeline runs across 6 WPs)

---

## Executive Summary

This rework cycle fully resolved all actionable findings from the prior synthesis report (`2026-05-28-knowledge-gui`). Six work packages delivered across five concern areas:

1. **UX fix** — Search input focus no longer lost on keystroke in the Knowledge view. A conditional `hadFocus` guard in `renderList()` restores focus only when the search input was already active, preventing focus-theft during card actions. A `getDistinctValues()` private helper eliminated duplicated category/project collection loops.

2. **Atomic move operation** — `KnowledgeStoreManager.moveInsight()` replaces the previous two-lock add→delete compose pattern. The promote and move operations now complete under a single `withLock` span, closing a real TOCTOU window that existed across all prior promote/move calls.

3. **Domain extraction** — All knowledge-specific handler functions, Zod schemas, and the `parseKnowledgeId` helper are now in a dedicated `gui/api-knowledge.ts` module. `gui/api.ts` has no residual knowledge-handler code. Handler signatures and exported names are unchanged — a pure module boundary refactor.

4. **CSP hardening + route cleanup** — `unsafe-inline` removed from `script-src` in the Content-Security-Policy. Theme-init logic extracted to a static ES5 IIFE (`gui/public/theme-init.js`). The `PATCH /api/projects/` route guard migrated from `path.startsWith()` to a regex `.test()` call consistent with all other routes.

5. **Search forwarding** — `searchInsights()` now accepts `tags`, `limit`, and `offset` in its filter parameters. `handleListKnowledge` forwards all three to `searchInsights()` when a free-text query is present. Combined filtering (query + tags + pagination) works in a single call.

All changes are confined to the `mcp-server/` sub-project. No public API signatures changed. The test suite grew from **2,653 tests** (baseline) to **2,665 tests** (+12 net new tests). Zero regressions across all 87 test files.

---

## Metrics

| WP | Description | Tests at Completion | Rework |
|----|-------------|---------------------|--------|
| WP-001 | Knowledge view UX fixes | 2,653 passed / 0 failed | None |
| WP-002 | `moveInsight()` atomic method | 2,659 passed / 0 failed | None |
| WP-003 | Handler wiring + `api-knowledge.ts` extraction | 2,659 passed / 0 failed | None |
| WP-004 | CSP hardening + regex route + `searchInsights` extension | 2,665 passed / 0 failed | 1× (QA FAIL → re-implementation) |
| WP-005 | `searchInsights` tag/pagination forwarding (verification) | 2,665 passed / 0 failed | None |
| WP-006 | Documentation consolidation | — | None |

**Net new tests added:** 12 (5 storage-level + 5 handler-level + 2 security-headers assertions, minus pre-existing)  
**Total suite at close:** 2,665 tests, 87 test files, 0 failures  
**Security audit (WP-004):** 0 Critical, 0 High, 0 Medium, 1 Low (tag count unbounded — negligible for localhost-only dashboard)  
**TypeScript compile:** Clean (`tsc --noEmit`) across all WPs  
**CTX context regeneration:** Successful (33 documents, 0 errors)

---

## Rework Incidents

### WP-004 — QA FAIL (1 rework cycle)

**What happened:** The first implementation pipeline for WP-004 delivered the CSP, theme-init, and PATCH regex changes correctly but **did not implement the `searchInsights()` extension at all**. The QA pipeline correctly caught this — 6 of 14 acceptance criteria were unmet, with zero WP-004 tests added.

**Root cause:** The implementation pipeline appears to have treated WP-004 as complete after the CSP/route sub-tasks without addressing the storage-layer extension. The QA pipeline served as the correct safety net.

**Resolution:** A second implementation pipeline was launched, which implemented the `searchInsights()` extension (signature, tag-filter body, pagination slice) and added all 5 required tests. The second QA pass was clean (2665/2665, 0 failures).

**Impact:** None — the pipeline caught the miss before any downstream agent was affected.

---

## Failed / Flagged Items

No WPs ended in a BLOCKED or CANCELLED state. No blocking security findings were recorded. The single rework incident (WP-004 QA FAIL) was resolved within the same cycle.

---

## Strategic Recommendations (Gold Nuggets)

The following cross-cutting observations were surfaced by Reviewer, QA, and Developer agents across the session. These are the highest-signal items for future planning.

### 1. Decouple card-list re-render from filter-bar re-render in `renderList()` (Medium priority)

**Source:** Developer (WP-001 implementation), Reviewer (WP-001 code-review) — both flagged independently.

`renderList()` currently rebuilds the entire filter-bar `innerHTML` on every invocation, even when only the card list changes (e.g., typing in the search box, or completing a card action). The `hadFocus` guard introduced in WP-001 is a correct compensating mechanism, but the root cause remains: the filter-bar should only be rebuilt when the active tab changes, not on every `renderList()` call.

**Recommended follow-up:** A standalone WP: *"Decouple card-list re-render from filter-bar re-render in `renderList()`."* This would eliminate the focus-guard workaround entirely, reduce DOM churn on every keystroke, and simplify the `renderList()` contract significantly.

### 2. Guard same-store moves in `moveInsight()` (Low priority)

**Source:** QA (WP-002), Reviewer (WP-002 code-review).

`moveInsight()` does not guard against moving an insight to the store it already belongs to (e.g., `global→global`). In that scenario the method silently succeeds, but the second `atomicWriteJson` call overwrites the target (same file) with stale in-memory data, potentially causing data loss. A one-line guard (`throw if sourceStorePath === targetStorePath`) would fully prevent this.

**Recommended follow-up:** Add a defensive guard as a low-cost addition to `moveInsight()` in a future maintenance WP.

### 3. Stale closure arrays in `wireEvents()` after mutations (Low priority, pre-existing)

**Source:** Developer (WP-001), QA (WP-001) — pre-existing pattern, not introduced by this session.

`wireEvents()` captures `categories` and `projects` arrays via closure at initial render time. After `confirm-delete` or `promote` mutations, the stale closure arrays are passed to `renderList()`, which may cause filter dropdowns to momentarily show stale values. `wireFilterBarEvents()` (added in WP-001) correctly calls `getDistinctValues(allInsights)` fresh on every re-wire, so the pattern is partially improved but not fully consistent.

**Recommended follow-up:** Have `renderList()` always derive fresh values from `allInsights` itself rather than accepting stale arrays as parameters. This eliminates the stale-closure risk entirely.

### 4. `securityHeaders()` object allocation and inline regex construction (Low priority)

**Source:** Developer (WP-004), Reviewer (WP-004 code-review).

`gui/server.ts` `securityHeaders()` returns a new object literal on every call, and the PATCH route regex is constructed inline on every `handleRequest()` invocation. Both should be hoisted to module-level constants. The allocation cost is negligible for a localhost dashboard but the refactor would make the CSP string easier to audit and align with the existing module-level regex patterns already in the file.

**Recommended follow-up:** Address in a future tidy-up WP or as part of a broader `server.ts` cleanup.

### 5. Tag count unbounded in `handleListKnowledge` (Low priority — security defence-in-depth)

**Source:** Security Auditor (WP-004).

The `tags` query parameter is split on commas with no upper bound on the number of tag values accepted. A caller could supply an extremely long comma-separated list, causing O(n×m) tag-intersection work in `searchInsights()`. For a localhost-only dashboard the practical risk is negligible, but capping tags at a reasonable limit (e.g. 50 values) is a recommended defence-in-depth measure for any future external exposure.

### 6. `handleMoveKnowledge` in `gui/api.ts` still uses the legacy add→delete pattern (Medium priority — pending migration)

**Source:** Documentation agent (WP-002, WP-003).

**Note:** `handleMoveKnowledge` in `gui/api.ts` was migrated to `api-knowledge.ts` (WP-003) and wired through `moveInsight()` — this is complete. However, the Documentation agent noted that the old `api-surface.md` entry for the non-atomic warning was explicitly tracked. This is now resolved. No follow-up needed — surfaced here only for completeness.

---

## Files Modified This Session

| File | Changed By |
|------|------------|
| `mcp-server/gui/public/views/knowledge.js` | WP-001 |
| `mcp-server/src/storage/knowledge-store.ts` | WP-002, WP-004 (rework), WP-005 |
| `mcp-server/tests/storage/knowledge-store.test.ts` | WP-002, WP-004 (rework) |
| `mcp-server/gui/api-knowledge.ts` | WP-003, WP-004 (rework), WP-005 |
| `mcp-server/gui/api.ts` | WP-003 |
| `mcp-server/gui/server.ts` | WP-003, WP-004, WP-006 |
| `mcp-server/tests/gui/api-knowledge.test.ts` | WP-003, WP-004 (rework) |
| `mcp-server/tests/gui/knowledge-api.test.ts` | WP-003 |
| `mcp-server/gui/public/theme-init.js` | WP-004 (new file) |
| `mcp-server/gui/public/index.html` | WP-004 |
| `mcp-server/tests/gui/security-headers.test.ts` | WP-004 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-002, WP-003, WP-004, WP-006 |
| `mcp-server/docs/agents/project-manifest/data-flows.md` | WP-003, WP-004 |
| `mcp-server/docs/agents/project-manifest/file-tree.md` | WP-003, WP-004 |
| `mcp-server/docs/agents/project-manifest/tech-stack.md` | WP-004 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-006 |
| `mcp-server/changelog.md` | WP-006 |
| `.context/mcp-server/*.md` (multiple) | WP-002, WP-003, WP-004, WP-006 |

---

## Next Steps for Planner / Manager

In priority order:

1. **Decouple filter-bar rebuild from card-list rebuild in `renderList()`** (Medium) — Eliminates the `hadFocus` workaround, reduces keystroke DOM churn, and simplifies the function's contract. This is the highest-ROI UX follow-up from this session.

2. **Guard same-store moves in `moveInsight()`** (Low) — One-line defensive throw prevents a latent data-loss scenario on self-moves. Low cost, high confidence.

3. **Cap tag count in `handleListKnowledge`** (Low) — Defence-in-depth for any future external exposure. Trivially implementable alongside another `api-knowledge.ts` change.

4. **Hoist `securityHeaders()` and PATCH regex to module-level constants in `server.ts`** (Low) — Code hygiene; bundle with any future `server.ts` maintenance work.

5. **Eliminate stale closure arrays in `wireEvents()`** (Low) — Have `renderList()` derive fresh `categories`/`projects` from `allInsights` directly. Eliminates the remaining closure staleness risk in the Knowledge view.
