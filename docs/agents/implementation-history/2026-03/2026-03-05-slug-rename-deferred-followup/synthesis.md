# Synthesis — Slug Rename Deferred Follow-up

**Project:** `2026-03-05-slug-rename-deferred-followup`
**Date:** 2026-03-05
**Status:** COMPLETE
**Work Packages:** 2 / 2 COMPLETE — all pipelines PASS

---

## What Was Delivered

This project resolved three deferred items from `2026-03-05-independent-title-slug-rename`, all shipped as a single coordinated fix in **v1.9.4**:

| Priority | Fix | Result |
|----------|-----|--------|
| Medium | `PATCH /projects/:slug { slug: currentSlug }` no longer throws an unhandled 500 | ✅ Returns HTTP 200 with unchanged metadata |
| Low | `SlugConflictError` typed class replaces fragile string-prefix matching in the catch block | ✅ `instanceof` check in production; class exported from `ledger-store.ts` |
| Low | Missing API-layer test for same-slug no-op path | ✅ 2 new tests added; suite grows from 56 → 58 in `handleRenameProject` |

**Test result:** 1109 / 1109 tests pass across 36 files. No new external dependencies.

---

## Files Changed

| File | Change |
|------|--------|
| `mcp-server/src/storage/ledger-store.ts` | Added `SlugConflictError` named export (lines 20–25); updated `renameSlug()` to throw `SlugConflictError` for the target-directory conflict case |
| `mcp-server/gui/api.ts` | Added same-slug pre-check in `handleRenameProject` (L686–688); replaced string-prefix catch with `instanceof SlugConflictError` (L692); updated import (L21) |
| `mcp-server/tests/gui/api.test.ts` | Added 2 tests: *same-slug no-op* and *combined title + same-slug no-op* (L658–690) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Added `SlugConflictError` export section (L509–520); updated `renameSlug()` throws table (L578–579); replaced "Known limitation" block in `handleRenameProject` with accurate post-fix documentation (L1435–1440) |
| `mcp-server/changelog.md` | Added v1.9.4 entry (L3–10) |

---

## Architectural Decisions

### Same-slug pre-check (not a wider catch)

The same-slug case is intercepted in `handleRenameProject` **before** calling `store.renameSlug()`:

```typescript
if (newSlug === slug) {
  latestMeta ??= await store.readProjectMeta();
} else {
  try {
    latestMeta = await store.renameSlug(newSlug);
  } catch (err: unknown) {
    if (err instanceof SlugConflictError) { … }
    throw err;
  }
}
```

This avoids reaching the storage layer for a pure no-op and decouples the handler from the wording of `renameSlug()`'s error messages. The nullish coalescing assignment (`??=`) correctly preserves any prior `updateTitle()` result rather than overwriting it.

### `SlugConflictError` co-location

`SlugConflictError` is exported from `ledger-store.ts` — the single throw site with a single consumer. A separate `src/utils/errors.ts` was considered and rejected: the class is too small, too specific, and co-location keeps the public API surface minimal. The `this.name = 'SlugConflictError'` assignment in the constructor ensures reliable `instanceof` checks across TypeScript transpilation boundaries.

### WP-002 as verification gate

WP-002 carried no file edits — all documentation was produced by WP-001's documentation pipeline. WP-002 served as a structured verification gate: QA, code-review, and documentation agents each independently confirmed all six acceptance criteria against live source before the project transitioned to COMPLETE.

---

## Open Items / Future Considerations

These are low-priority observations recorded during code review and QA — no action is required to ship v1.9.4:

1. **Defensive guard annotation** — `ledger-store.ts:350–353` retains a plain `Error` throw for the same-slug guard. This code path is now unreachable from `handleRenameProject` due to the upstream pre-check. A brief inline comment (e.g. `// defensive guard: upstream handler prevents this branch`) would clarify intent for future maintainers. Raised by code-review (WP-001 and WP-002).

2. **`renameSlug` spy in no-op test** — The same-slug no-op test uses an `access()` directory check as a behavioural proxy to confirm no rename occurred. A `vi.spyOn` on `store.renameSlug` would make the assertion explicit. Current coverage is sufficient. Raised by code-review (WP-001).

3. **Direct callers of `renameSlug()`** — If `renameSlug()` is ever called directly with the same slug (outside the API handler), the caller receives a plain `Error` rather than a `SlugConflictError`. The method's current public surface does not expose this scenario, but it is worth revisiting if the method's consumers expand. Raised by code-review (WP-002).

---

## Pipeline Health

| WP | Implementation | QA | Code Review | Documentation |
|----|---------------|-----|-------------|---------------|
| WP-001 | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS |
| WP-002 | ✅ PASS | ✅ PASS | ✅ PASS | ✅ PASS |

All pipelines completed without rework cycles.
