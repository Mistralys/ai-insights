# Project Status Report — GUI API Hardening
**Plan:** `2026-02-28-gui-api-hardening`
**Date:** 2026-02-28
**Status:** COMPLETE — All 4 work packages delivered

---

## Executive Summary

This session closed three targeted security and quality gaps surfaced in the prior `2026-02-28-ledger-document-archiving-rework-1` synthesis report, all confined to `mcp-server/`. No MCP tool API contracts were changed. No breaking changes to the ledger schema.

**What was built:**

1. **`assertSafeWpId()` path-traversal guard (WP-001):** A non-exported `assertSafeWpId(wpId: string): void` function was added to `gui/api.ts`, mirroring the existing `assertSafeSlug()` pattern. It rejects empty, `/`-containing, and `..`-containing `wpId` values with HTTP 404 before any file-system access occurs. It is deployed as the second statement inside `handleGetWorkPackage()`, closing the traversal surface on the `GET /api/projects/:slug/work-packages/:wpId` route.

2. **`plan_file` coupling enforcement (WP-002):** A Zod `.refine(v => v === PLAN_ARCHIVE_FILENAME)` was added to the `plan_file` parameter of `ledger_initialize_project`. This converts an implicit coupling — where mismatched filenames silently produced 404s at the GUI plan endpoint — into an explicit, user-visible validation error at initialization time.

3. **Test constant de-literalization (WP-003):** 20+ hardcoded `'plan.md'` and `'synthesis.md'` literals in `tests/gui/api.test.ts` and `tests/storage/ledger-store.test.ts` were replaced with `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` constants. Tests now describe intent rather than magic string values.

4. **Manifest synchronization (WP-004):** `api-surface.md` and `constraints.md` were updated to document both path-traversal guards and the `plan_file` Zod constraint, verified by a read-against-source check.

---

## Metrics

| Metric | Value |
|---|---|
| Work Packages | 4 / 4 COMPLETE |
| Pipelines executed | 16 (4 × implementation + QA + code-review + documentation) |
| Pipeline failures | 0 |
| Tests passing | 538 |
| Tests failing | 0 |
| Test files covered | 27 / 27 |
| New test cases added | +3 (WP-001 traversal block) + +2 (WP-002 refine negative/positive) = **+5** |
| Security issues | 0 |

### Files Modified

| File | Changed By |
|---|---|
| `mcp-server/gui/api.ts` | WP-001 |
| `mcp-server/tests/gui/api.test.ts` | WP-001, WP-003 |
| `mcp-server/src/tools/project-lifecycle.ts` | WP-002 |
| `mcp-server/tests/tools/project-lifecycle.test.ts` | WP-002 |
| `mcp-server/tests/storage/ledger-store.test.ts` | WP-003 |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | WP-001, WP-002, WP-004 |
| `mcp-server/docs/agents/project-manifest/constraints.md` | WP-001, WP-002, WP-004 |

---

## Strategic Recommendations (Gold Nuggets)

These observations were raised consistently across multiple WPs and warrant consideration in a future session:

### 1. Consolidate `assertSafeSlug` + `assertSafeWpId` into a shared `assertSafePathSegment` helper
**Priority:** Low | **Raised by:** Developer, Reviewer (WP-001)

`assertSafeSlug(slug: string): void` and `assertSafeWpId(wpId: string): void` are structurally identical 3-line functions differing only in parameter name. A single `assertSafePathSegment(value: string, label: string): void` helper — potentially in a `guards.ts` module — would eliminate duplication and ensure future changes to rejection criteria (see item 2 below) apply uniformly. Currently non-blocking since both are internal and the distinct names serve a documentation purpose.

### 2. Add explicit control character rejection to path segment guards
**Priority:** Low | **Raised by:** QA, Reviewer (WP-001)**

Both guards currently reject only empty strings, `/`, and `..`. Values containing newlines (`\n`), NUL bytes (`\0`), or carriage returns (`\r`) pass through to `path.join()` and fail naturally at the filesystem level (with Zod parse as a secondary barrier). No security bypass is possible in practice, but adding an explicit `/[\r\n\0]/` check would make the guards more defensive-in-depth. Best implemented atomically when item 1 is addressed, so the check lives in one place.

### 3. Standardize schema exports across `project-lifecycle.ts`
**Priority:** Low | **Raised by:** Reviewer (WP-002)

`InitializeProjectSchema` is now the only exported schema in `project-lifecycle.ts` — all four sibling schemas (`DetectProjectSchema`, `GetProjectStatusSchema`, `ListProjectsSchema`, `CompleteSynthesisSchema`) remain unexported. The asymmetry is a pragmatic minimal-change decision. A future follow-up could standardize the pattern across all tools: either export all schemas (enabling direct test-side `safeParse` access) or introduce a thin exported validator function per tool to keep schemas private and avoid coupling test code to the Zod schema directly.

---

## Blockers / Failures

None. All pipelines PASS. No security issues. No test regressions.

---

## Next Steps

The three strategic items above are all low-priority and can be batched into a single future "internal code quality" plan. Suggested plan scope:

1. **`guards.ts` extraction:** Create `mcp-server/gui/guards.ts` with a single `assertSafePathSegment(value, label)` helper. Refactor `assertSafeSlug` and `assertSafeWpId` to delegate to it. Add control-character rejection while there.
2. **Schema export standardization:** Audit all tools files and decide on a consistent pattern. Update manifests accordingly.

Both items are incremental improvements with no urgency. The codebase is in a clean, consistent state as delivered.
