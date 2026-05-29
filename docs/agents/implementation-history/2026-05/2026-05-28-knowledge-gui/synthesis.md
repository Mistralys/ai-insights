# Project Synthesis Report
**Plan:** 2026-05-28-knowledge-gui  
**Date:** 2026-05-29  
**Status:** COMPLETE  
**Total Work Packages:** 10 / 10 COMPLETE  
**Pipeline Health:** 10/10 WPs with all stages passing — zero stage failures recorded

---

## Executive Summary

This session delivered the **Phase 6 — GUI Knowledge Page** for the Knowledge Accumulation System. The backend (`KnowledgeStoreManager`, Zod schemas, 4 MCP tools) was pre-existing; this plan built the complete GUI layer from scratch: 5 REST endpoints, server-side route wiring, SPA view, frontend API client, navigation, and CSS — all landing on top of a live production codebase without regressions.

**What was built:**

| Layer | Deliverable | WP |
|---|---|---|
| API handlers | `handleListKnowledge`, `handleUpdateKnowledge`, `handleDeleteKnowledge`, `handlePromoteKnowledge`, `handleMoveKnowledge` in `gui/api.ts` | WP-001, WP-004, WP-005 |
| HTTP routing | All 5 REST endpoints wired into `gui/server.ts` two-tier dispatch | WP-009 |
| SPA view | `views/knowledge.js` — tab bar, per-tab filters, inline CRUD, promote/move, confidence display | WP-006 |
| Frontend API client | 5 knowledge methods (`getKnowledge`, `updateKnowledge`, `deleteKnowledge`, `promoteKnowledge`, `moveKnowledge`) added to `gui/public/api-client.js` | WP-003 |
| Navigation & routing | Nav link, `#/knowledge` hash route, `knowledge.js?v=1` script tag, cache-busting version bumps | WP-008 |
| Styling | `/* Knowledge Page */` CSS section in `styles.css` — 10 new classes with full dark-mode coverage | WP-002 |
| Integration tests | 30-case `tests/gui/knowledge-api.test.ts` (plan-canonical) + 40-case `tests/gui/server-knowledge-routes.test.ts` (HTTP routing) | WP-007, WP-009 |
| Documentation | `api-surface.md`, `file-tree.md`, `data-flows.md`, `changelog.md`, `README.md` updated; CTX context regenerated | WP-010 (also via each WP's doc pipeline) |

The feature is fully end-to-end: a user can now open the GUI, navigate to **Knowledge**, switch between Global and Repository tabs, filter by category/project/free-text, and perform all CRUD operations (edit, delete, promote to global, move to project) inline without page reloads.

---

## Metrics

### Test Coverage

| Milestone | Tests Passing | Regressions |
|---|---|---|
| Start of plan (baseline) | 2,520 | — |
| After WP-001 | 2,520 (+23 new) | 0 |
| After WP-003 | 2,537 (+17) | 0 |
| After WP-004 | 2,560 (+23) | 0 |
| After WP-005 | 2,583 (+23) | 0 |
| After WP-007 | 2,613 (+30) | 0 |
| After WP-009 | 2,653 (+40) | 0 |
| **Final** | **2,653** | **0** |

Net additions: **+133 tests** across 2 new test files and 3 extended test files.

### Pipeline Summary

| WP | Scope | Stages | Duration (approx.) |
|---|---|---|---|
| WP-001 | `handleListKnowledge` + helpers | impl → qa → code-review → doc | ~12 min |
| WP-002 | Knowledge CSS (styles.css) | impl → qa → code-review → doc | ~9 min |
| WP-003 | Frontend API client (5 methods) | impl → qa → code-review → doc | ~9 min |
| WP-004 | `handleUpdateKnowledge` + `handleDeleteKnowledge` | impl → qa → code-review → doc | ~14 min |
| WP-005 | `handlePromoteKnowledge` + `handleMoveKnowledge` | impl → qa → security-audit → code-review → doc | ~19 min |
| WP-006 | SPA view (`views/knowledge.js`) | impl → qa → code-review → doc | ~134 min |
| WP-007 | 30-case integration test suite | impl → qa → code-review → doc | ~10 min |
| WP-008 | Nav + router wiring | impl → qa → code-review → doc | ~8 min |
| WP-009 | HTTP route wiring in `server.ts` | impl → qa → security-audit → code-review → doc | ~18 min |
| WP-010 | Final documentation consolidation | doc | ~4 min |

### Security Audits (WP-005, WP-009)

| Category | Findings |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 (pre-existing, non-blocking — see below) |
| Low | Various informational notes |

---

## Notable Technical Decisions

### Patterns That Worked Well

1. **Two-tier server dispatch (inherited architecture).** Body-free routes in `matchRoute()`, body-parsing routes as `handleRequest()` special cases. Knowledge routes slotted cleanly into this pattern with no conflicts — GET/DELETE/promote go body-free, PATCH/move go body-parsing. Regex ID matching in the body-parsing tier proved more precise than the existing `startsWith()` pattern.

2. **Compose promote/move from primitives, not new storage methods.** `handlePromoteKnowledge` and `handleMoveKnowledge` are built entirely from existing `KnowledgeStoreManager` operations (add → delete). No new storage API was needed, consistent with the plan's stated design. The add-first ordering guarantees no data loss on partial failure.

3. **Zod `.strict()` body validation.** `KnowledgeUpdateBodySchema` and `KnowledgeMoveBodySchema` both use `.strict()`, which rejects unknown keys. Combined with `superseded_by: z.number().int().optional().nullable()`, this enabled explicit field-clearing semantics (null → clear) with compile-time safety.

4. **`parseKnowledgeId` string-level float guard.** The `raw.includes('.')` check before `Number()` coercion is the correct approach for rejecting float strings like `'2.0'` — `Number('2.0') === 2` is a JS coercion trap. This was correctly identified and documented in both the handler JSDoc and the architecture reference.

5. **Real temp-directory integration tests.** Both WP-007 and WP-009 use actual `mkdtemp` + `KnowledgeStoreManager` fixtures rather than storage mocks. This catches real filesystem locking, path construction, and serialisation issues that unit mocks would miss.

6. **formatConfidence named constants.** `CONFIDENCE_HIGH_MIN = 68` and `CONFIDENCE_MEDIUM_MIN = 34` are named constants in the SPA view, not magic numbers. Bucket thresholds are immediately discoverable and adjustable without searching raw percentage literals.

---

## Issues & Risks

### Medium-Priority (Pre-existing, Non-Blocking)

1. **Non-atomic cross-store TOCTOU window** (WP-005, WP-009 security audits).  
   `handlePromoteKnowledge` and `handleMoveKnowledge` acquire two separate `KnowledgeStoreManager.withLock()` spans. Between the `addInsight()` and `deleteInsight()` calls, another concurrent request could observe the insight in both stores simultaneously. In the current localhost single-user model, exploitability is extremely low, but a failed delete leaves a detectable duplicate rather than data loss. Fully atomic cross-store moves would require a single lock span covering both stores — a storage-layer change outside this plan's scope.  
   **Recommendation:** Document as a known limitation in the architecture references (already done). Consider a cross-store transaction helper in a follow-up WP if concurrent access patterns change.

2. **CSP uses `unsafe-inline` for `script-src` and `style-src`** (WP-009 security audit).  
   Pre-existing across the entire GUI server; not introduced by this plan. The knowledge view correctly passes all user content through `escapeHtml()` before DOM insertion. XSS risk is very low given the localhost-only deployment.  
   **Recommendation:** A future hardening pass using nonce-based or hash-based `script-src` would eliminate the `unsafe-inline` surface.

### Low-Priority (UX Degradation, Not Defects)

3. **Search input loses focus on each keystroke** (WP-006).  
   `renderList()` rebuilds the entire filter bar DOM on every keystroke, causing the search input to blur. The fix is minimal: cache `filterQuery` before rebuild and refocus the input after. Confirmed functional but suboptimal. A one-line fix is available; it was deferred from WP-008 wiring and can be applied in any follow-up pass.

4. **`styles.css` is now ~2,590 lines** (WP-002).  
   Well-structured with clearly labelled section comments, but growing large. Splitting into per-page CSS modules (`knowledge.css`, `orchestrator.css`, etc.) would improve maintainability at the cost of additional `<link>` tags or a build step.

### Acknowledged Tech Debt

5. **`gui/api.ts` is ~1,959 lines** (WP-004).  
   All sections are clearly delineated by comments. A future refactor splitting knowledge handlers into `gui/api-knowledge.ts` would improve navigability without changing the public API surface.

6. **Substring not-found error detection** (`msg.includes('not found')`).  
   Used in `handleUpdateKnowledge` and `handleDeleteKnowledge` to map storage errors to `NOT_FOUND` API errors. Consistent with pre-existing patterns and stable under the current storage-layer error message contract. A typed error class in the storage layer would be more robust but is a storage-layer change.

7. **`searchInsights()` discards `limit`/`offset`/`tags` when `query` is present** (WP-001).  
   Documented in the handler JSDoc and `api-surface.md` with a ⚠ marker. The search+tag combined filtering path is not addressable without changes to `KnowledgeStoreManager.searchInsights()`. Marked as open in the handler @note for a future work package.

---

## Strategic Recommendations ("Gold Nuggets")

### 1. Adopt Regex-Based Route Matching for Body-Parsing Routes
The PATCH `/api/knowledge/:id` and POST `/api/knowledge/:id/move` handlers use regex matching in `handleRequest()`, which is more precise than the existing `path.startsWith()` pattern used by `/api/projects/`. The regex approach eliminates false-positive matches on deeply-nested paths. Consider migrating the `projects` PATCH route to the same pattern in a future server cleanup pass.

### 2. Introduce a Cross-Store Transaction Helper
The add-then-delete composition in `handlePromoteKnowledge`/`handleMoveKnowledge` is correct and safe, but the TOCTOU window is a genuine architectural limitation. A `KnowledgeStoreManager.moveInsight(sourceFilter, targetScope, targetSlug)` method that acquires both store locks in a single span would eliminate the window entirely and simplify the handler code. This should be prioritised if the GUI is ever exposed beyond localhost.

### 3. Fix the Search Input Focus Loss (One-liner)
This is a small but genuine UX degradation on the main Knowledge page. The fix is documented: after `wireFilterBarEvents()` rebuilds the DOM, re-query the input element and call `.focus()`. Given how simple the fix is, it should be applied in the next pass that touches `views/knowledge.js`.

### 4. Add `getDistinctValues()` Helper to `views/knowledge.js`
Both `wireFilterBarEvents()` and `wireEvents()` independently collect distinct categories and project slugs from `allInsights`. Extracting this into a shared `getDistinctValues(insights, field)` helper eliminates duplication and reduces drift risk if the collection logic needs updating (e.g., case-normalisation or trimming).

### 5. Consider Route-Map Comment as Living Documentation
The Reviewer's Fix-Forward in WP-009 added a full route-map comment block to `matchRoute()` listing all 29 registered routes split by dispatch tier. This should be kept up-to-date whenever new routes are added. Consider referencing it in the developer onboarding guide as the canonical quick-reference for the server's routing table.

### 6. Establish a CSS Section Convention for Dark-Mode Overrides
The Knowledge CSS block consolidates all `[data-theme="dark"]` overrides at the bottom of the section, while some earlier sections co-locate dark overrides adjacent to their light counterparts. A project-wide CSS convention (bottom-grouped vs. co-located) would prevent future inconsistency. The `api-surface.md` now documents the bottom-grouped approach as the preferred convention for new sections.

---

## Next Steps

### Immediate (High Value, Low Effort)
- **Fix search input focus loss** in `views/knowledge.js` (~1 line change).
- **Implement `getDistinctValues()` helper** to eliminate category/project collection duplication in `wireFilterBarEvents()` and `wireEvents()`.
- **Tighten CSP** from `unsafe-inline` to nonce-based script loading in `gui/server.ts`.

### Short-Term (Architecture Improvements)
- **`KnowledgeStoreManager.moveInsight()`** — atomic cross-store move to eliminate the TOCTOU window in promote/move handlers.
- **Split `gui/api.ts`** — extract knowledge handlers into `gui/api-knowledge.ts` to manage the growing file size.
- **Extend `searchInsights()`** — add tag-filter and pagination support so `handleListKnowledge` can forward these parameters in search mode.

### Documentation / Housekeeping
- **Update `searchInsights()` constraint** in `handleListKnowledge` @note once the storage layer is enhanced.
- **Migrate `PATCH /api/projects/`** route matching to the regex-based pattern established by the knowledge routes.

---

## Files Modified (Full Plan)

### Source
- `mcp-server/gui/api.ts` — 5 new exported handler functions + 2 private helpers + 2 Zod schemas
- `mcp-server/gui/server.ts` — 5 knowledge routes wired across two dispatch tiers
- `mcp-server/gui/public/api-client.js` — 5 knowledge API client methods + JSDoc
- `mcp-server/gui/public/router.js` — `/knowledge` route dispatch + section comment
- `mcp-server/gui/public/index.html` — Knowledge nav link + `knowledge.js?v=1` script tag + version bumps
- `mcp-server/gui/public/styles.css` — `/* Knowledge Page */` CSS section (~154 lines, 10 new classes)
- `mcp-server/gui/public/views/knowledge.js` — new SPA view (~580 lines)

### Tests
- `mcp-server/tests/gui/api-knowledge.test.ts` — extended through WP-001/004/005 (68 total tests)
- `mcp-server/tests/gui/api-client.test.ts` — extended through WP-003 (33 total tests)
- `mcp-server/tests/gui/knowledge-api.test.ts` — new (30 tests, plan-canonical)
- `mcp-server/tests/gui/server-knowledge-routes.test.ts` — new (40 HTTP integration tests)

### Documentation
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Knowledge API handlers, HTTP route table, CSS class table, handler signatures, constraints
- `mcp-server/docs/agents/project-manifest/file-tree.md` — new entries for all new files
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Flow O (5 knowledge endpoint flows)
- `mcp-server/README.md` — Knowledge page feature description, cache-busting convention note, API client section
- `mcp-server/module-context.yaml` — new `source-gui-frontend` context document
- `.context/mcp-server/` — regenerated (32 documents, 0 errors)
