# Project Synthesis Report

**Plan:** `2026-05-31-orchestrator-sidecar-gui-resume-rework-2`  
**Status:** COMPLETE  
**Date:** 2026-05-31  
**Work Packages:** 15 / 15 COMPLETE  
**Pipeline Stages Passed:** 63 total (61 PASS across implementation/qa/code-review/documentation + 2 security-audit passes on WP-004 and WP-007)

---

## Executive Summary

This plan completed the full end-to-end namespace migration for the AI Insights MCP server GUI stack. Prior to this work, the server-side API had been fully migrated to namespaced routes (`/api/projects/:repo/:slug/...`) months earlier, but every frontend layer — the API client, the SPA router, all view components, the orchestrator queue, and the Python CLI — still used the legacy bare-slug form. This created correctness risks for multi-root workspaces where slug collisions are possible, and accumulated route-duplication debt on the server.

**What was built:**

1. **API client migration (WP-001):** All 22 project-scoped methods in `api-client.js` now accept `(repo, slug)` and construct namespaced URLs. Full JSDoc added to all migrated methods.

2. **Orchestrator queue — Python side (WP-002):** `run_queue.register()` now accepts `repo_name` and writes `expectedRepo` to queue JSON. `cli.py` derives the repo name from `plan_dir.parents[3].name`. Input normalization added (`repo_name or None`).

3. **Test factory helper (WP-003):** New `createNamespacedProject(repo, slug)` factory in `tests/gui/helpers/` produces properly-structured ledger directories for namespace-aware GUI tests.

4. **Queue entry TypeScript types (WP-004):** `RawQueueEntry` interface extended with `expectedRepo: string | null`. `isRawQueueEntry()` normalizes legacy entries (missing `expectedRepo` → `null`) in-place at the read boundary. Security audit confirmed no prototype-pollution risk; one medium finding (empty-string `expectedRepo` should be guarded in path ops downstream) noted for follow-up.

5. **Diagnostic logging (WP-005):** `resolveProjectStore()` catch block upgraded from bare `catch {}` to `catch (err)` with `process.stderr.write`, surfacing metadata read failures to operators.

6. **InsightEntry interface (WP-006):** `repository_name: string | null` field added to `InsightEntry` and populated from `inferProjectRootFromPlanPath()` in `handleGetInsights()`. Weak null-path test identified and fixed during documentation pipeline.

7. **Queue path resolution (WP-007):** `getProjectLedgerStatus()` now uses namespaced path `join(ledgerRoot, expectedRepo, slug, ...)` when `expectedRepo` is non-null, falling back to flat layout for legacy entries. `killQueueEntry()` and `dismissQueueEntry()` in `orchestrator-manager.ts` updated accordingly. Security audit flagged medium path-traversal risk on `expectedRepo` path-component — `assertSafeSegment()` guard recommended as follow-up.

8. **Router migration (WP-008):** All five SPA hash route patterns updated from `#/projects/:slug/...` to `#/projects/:repo/:slug/...`. `breadcrumb().project()` updated to two-argument `(repo, slug)`. `ProjectNameCache` key scheme changed to composite `repo/slug`.

9. **Project list view (WP-009):** All links and action-menu API calls in `project-list.js` use namespaced form. Null `repository_name` rows render as read-only (no broken links). `alert()` in null-repo guard replaced with `console.error + silent skip` during code review.

10. **Work-package and run-log views (WP-010):** `renderWorkPackageDetail` and `renderRunLog` migrated to `(app, repo, slug, ...)` signatures. All 17 pre-existing `dialogue-qa.test.ts` failures (WP-001 regression) resolved by updating test call sites.

11. **Orchestrator queue view (WP-011):** `orchestrator.js` queue view generates namespaced log links and View Project links. Legacy null-`expectedRepo` entries handled gracefully (no links, no broken URLs).

12. **Insights and knowledge views (WP-012):** `insights.js` and `knowledge.js` both generate namespaced `#/projects/{repo}/{slug}` links when `repository_name` is available, with plain-text / `<span>` fallbacks for null entries.

13. **Project detail view + widgets (WP-013):** `renderProjectDetail`, `renderPlan`, `renderSynthesis`, and `showResetModal` all migrated to `(repo, slug)` signatures. `orchestrator-widgets.js renderLogPreview` updated from 3-arg to 4-arg form (resolving the pre-existing stale API call flagged by the Reviewer during WP-010). `ProjectNameCache.set()` now uses composite `repo/slug` key.

14. **Backward-compatibility deprecation comments (WP-014):** 21 `@deprecated` inline comments added to all non-namespaced route blocks in `server.ts`. Route map summary restructured into ACTIVE / DEPRECATED sections.

15. **Final documentation pass (WP-015):** `api-surface.md` route table rebuilt with separate Active/Deprecated sections. `data-flows.md` gains Flow 14 (Frontend Namespace Resolution). `constraints.md` gains Constraint 25 (Queue `expectedRepo` field). All 27 `.context/` files regenerated.

---

## Metrics

| Metric | Value |
|--------|-------|
| Work Packages | 15 / 15 COMPLETE |
| Total pipeline stages passed | 63 |
| Security audits | 2 (WP-004, WP-007) — both PASS |
| Security findings (Critical / High) | 0 |
| Security findings (Medium) | 2 (path-traversal / empty-string guards — follow-up recommended) |
| Tests passing at completion (WP-013) | 2,843 / 2,843 |
| Tests passing at completion (WP-014) | 2,843 / 2,843 |
| Pre-existing failures resolved | 17 (dialogue-qa.test.ts — resolved in WP-010) |
| Reviewer Fix-Forward edits applied | 7 across WP-002, WP-003, WP-004, WP-006, WP-008, WP-009, WP-013 |
| Files modified (estimated) | ~35 source + test + docs files |

---

## Aggregate Failure Indicators

### Pre-Existing Debt Resolved

| Item | Location | Resolved By |
|------|----------|-------------|
| 17 failing `dialogue-qa.test.ts` tests (stale 1-arg API signatures) | `tests/gui/dialogue-qa.test.ts` | WP-010 |
| `orchestrator-widgets.js` 3-arg `getRunLogEntries` mismatch | `orchestrator-widgets.js:278` | WP-013 |
| `ProjectNameCache` bare-slug key causing cross-repo collisions | `utils.js` | WP-009 + WP-013 |
| Tautological AC-3 null-path test in `handleGetInsights` | `api.test.ts:611` | WP-006 |

### Known Open / Follow-Up Items

| Priority | Item | Location |
|----------|------|----------|
| **Medium** | Empty-string `expectedRepo` passes type guard but should be rejected before path construction | `validate-entry.ts`, `get-queue.ts` |
| **Medium** | `expectedRepo` / `expectedSlug` not validated with `assertSafeSegment()` before `path.join()` — path traversal defense-in-depth gap | `get-queue.ts:getProjectLedgerStatus()` |
| Low | `_derive_repo_name(plan_dir, fallback=None)` helper to DRY `cli.py` + `_derive_ledger_log_dir()` | `orchestrator/src/cli.py` |
| Low | `renderRunsList` nested closure in `project-detail.js` is a refactor candidate (depth + testability) | `project-detail.js:~510` |
| Low | `ProjectNameCache` has no TTL or eviction — unbounded growth in long sessions | `utils.js` |
| Low | No dedicated jsdom unit tests for `project-list.js` buildTable / action-menu logic | Test coverage gap |

---

## Strategic Recommendations (Gold Nuggets)

### 1. Add `assertSafeSegment()` Guards at the Queue Read Boundary

Both the Security Auditor (WP-004, WP-007) and the Reviewer (WP-007) independently identified that `expectedRepo` and `expectedSlug` are used as `path.join()` components without content validation. The fix is one line per call site using `assertSafeSegment()` from `src/utils/path-validator.ts`, which already exists. This should be the highest-priority follow-up to this plan — the exploitability is low (local-only tool, trusted input source), but the fix is trivial and aligns with existing project conventions.

### 2. The `isRawQueueEntry()` Side-Effect Pattern Is Architecturally Unusual but Well-Documented

The decision to perform in-place mutation inside a type-guard function is intentional and pragmatic (avoids a second mapping pass over `Array.filter()` output). Multiple pipeline agents noted it, and the code now carries clear JSDoc explaining the side effect. If a second consumer of raw queue data is added, consider revisiting toward a pure two-step pattern (validate then normalize at the call site) to avoid surprises.

### 3. Test Depth Matters for `null`-Path Coverage

The WP-006 Reviewer discovered that the `repository_name: null` path test was tautologically true — the assertion `=== null || typeof ... === 'string'` always passes. The root cause was that `createProject()` uses `join(tmpdir(), slug)` which on macOS is deep enough to yield a non-null repo name. The new `createNamespacedProject()` factory (WP-003) solves this at the tooling level, and the fixed test now uses a genuinely shallow path. When writing null-guard tests, always verify the assertion is actually falliable by checking the intermediate values.

### 4. Composite `repo/slug` Cache Keys Should Be Centralized

The `ProjectNameCache` key construction (`repo + '/' + slug`) was duplicated in two places by the time WP-009 landed. The Reviewer flagged a `makeProjectCacheKey(repo, slug)` helper as a non-blocking improvement. Given that this cache is consulted by multiple views, a shared helper in `utils.js` would prevent separator drift in future views.

### 5. Document the Display vs. Storage Semantics of `repository_name`

The `repository_name` derivation in `handleGetInsights()` and `handleListProjects()` deliberately does **not** use `deriveRepoName()` (which lowercases and validates). Inline comments were added explaining this distinction (display field vs. storage key). This is an important invariant: the GUI should display the original-casing repo name, but the ledger storage key is always lowercased. Future developers must not conflate the two.

---

## Next Steps for Planner / Project Manager

1. **Immediate (follow-up hardening):** Open a new plan to add `assertSafeSegment()` path-component guards for `expectedRepo` and `expectedSlug` in `get-queue.ts` and `validate-entry.ts`. The Security Auditor marked this Medium priority and the Reviewer echoed it — it is the most actionable item remaining from this plan.

2. **Short-term:** Remove the 21 deprecated non-namespaced route blocks in `server.ts`. These are now clearly marked with `@deprecated` comments pointing to their replacements. Removal should happen in the next major version as promised.

3. **Short-term:** Extract `_derive_repo_name(plan_dir, fallback=None)` helper in `orchestrator/src/cli.py` to DRY the two identical `parents[3].name` IndexError blocks.

4. **Medium-term:** Add jsdom unit tests for `project-list.js` buildTable and action-menu rendering. There are currently no dedicated tests — all AC verification for WP-009 was done via static analysis.

5. **Medium-term:** Address `ProjectNameCache` unbounded growth. A simple max-size eviction or per-navigation clear would prevent memory pressure in long SPA sessions with many projects.

6. **Future:** The `renderRunsList` nested closure in `project-detail.js` should be extracted to a module-level helper for testability. The inline comment flagging it as a refactor candidate has been updated to include the full `(sorted, repo, slug, activeFilename, matchingQueueEntry)` signature — ready for a future refactor WP.
