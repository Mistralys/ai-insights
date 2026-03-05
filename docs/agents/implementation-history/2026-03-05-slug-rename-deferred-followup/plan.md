# Plan

## Summary

Address the three deferred items from `2026-03-05-independent-title-slug-rename`. The medium-priority item — a `PATCH /api/projects/:slug { slug: currentSlug }` request causing an unhandled 500 — must be fixed. Two low-priority items are included in the same work package because they are mechanically coupled to the fix: replacing fragile string-prefix matching in the `handleRenameProject` catch block with a typed `SlugConflictError` class, and adding the missing API-layer test that covers the same-slug no-op path. All three changes are small and confined to three files; shipping them together avoids a second patch cycle.

---

## Architectural Context

The rename feature delivered in v1.9.3 spans three layers:

- **Storage** — `mcp-server/src/storage/ledger-store.ts`: `LedgerStore.renameSlug(newSlug)` throws two distinct plain `Error` objects:
  - `Error('Slug is already "…"; no rename needed.')` — same-slug no-op guard.
  - `Error('Slug already in use: "…".')` — target directory already exists.
- **API** — `mcp-server/gui/api.ts`: `handleRenameProject` wraps the `renameSlug()` call in a `try/catch` that inspects `err.message.startsWith('Slug already in use:')` to produce a typed `ApiError('CONFLICT', …)` via the `conflict()` helper. Any other thrown error is re-thrown uncaught, including the same-slug error.
- **Tests** — `mcp-server/tests/gui/api.test.ts`: the `handleRenameProject` suite (56 tests as of v1.9.3) has no test for `{ slug: currentSlug }`.
- **Manifest** — `mcp-server/docs/agents/project-manifest/api-surface.md`: documents the same-slug no-op as a known limitation.

The `SlugConflictError` type does not yet exist in the codebase. No `src/utils/errors.ts` exists; the storage layer currently uses only plain `Error` instances for all thrown conditions.

---

## Approach / Architecture

### Fix 1 — Same-slug no-op: pre-check in `handleRenameProject` (Medium priority)

Add a pre-check in `handleRenameProject` **before** calling `store.renameSlug()`. If `newSlug === slug` (the route parameter), skip the storage call entirely and fall through to the existing `return latestMeta!` path, materialising `latestMeta` via `store.readProjectMeta()` if the title branch did not already populate it.

```typescript
if (newSlug !== undefined) {
  if (newSlug === slug) {
    // Same-slug no-op: nothing to rename. Materialise latestMeta if needed.
    latestMeta ??= await store.readProjectMeta();
  } else {
    try {
      latestMeta = await store.renameSlug(newSlug);
    } catch (err: unknown) { … }
  }
}
```

This is preferred over widening the catch prefix because:
- It avoids reaching the storage layer for a pure no-op.
- It expresses the intent explicitly.
- It is decoupled from the `renameSlug()` error message wording.
- It pairs naturally with Fix 2, where the catch can use `instanceof` instead of a string prefix.

### Fix 2 — Typed `SlugConflictError` (Low priority)

Export a `SlugConflictError` class from `ledger-store.ts`. There is no existing `src/utils/errors.ts`, and this is a single class with a single consumer — co-location with the thrower is the right choice. `ledger-store.ts` already exports `LedgerStore` and (via re-export) `SAFE_SLUG_REGEX`; a named export for `SlugConflictError` fits the existing pattern.

`SlugConflictError` applies **only** to the target-directory conflict case (`'Slug already in use: …'`). The same-slug no-op case is removed from the catch entirely by Fix 1. After the fix, `renameSlug()` still throws a plain `Error` for the same-slug guard, but that code path is now unreachable from `handleRenameProject` for well-formed clients — and the test (Fix 3) confirms the pre-check route.

```typescript
// ledger-store.ts (new export)
export class SlugConflictError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: "${slug}".`);
    this.name = 'SlugConflictError';
  }
}
```

Update the `throw new Error('Slug already in use: …')` in `renameSlug()` to `throw new SlugConflictError(newSlug)`.

Update the `api.ts` catch block from string-prefix matching to `err instanceof SlugConflictError`:

```typescript
} catch (err: unknown) {
  if (err instanceof SlugConflictError) {
    conflict(`Slug already in use: '${newSlug}'.`);
  }
  throw err;
}
```

### Fix 3 — Test for same-slug no-op (Low priority)

Add one test in the `handleRenameProject` describe block in `mcp-server/tests/gui/api.test.ts`:

- **Case:** `PATCH /projects/:slug { slug: <same slug> }` → 200 with metadata unchanged (`slug`, `title`, `last_updated` all equal to pre-request values).
- The test proves that the pre-check route returns correct data and does not accidentally call `renameSlug()` (no disk mutation).

A combined `{ title: 'New Title', slug: currentSlug }` test is also worth adding to confirm that the title update is still applied when the slug is a no-op.

### Fix 4 — Manifest update

Remove the "Known limitation" notice from `mcp-server/docs/agents/project-manifest/api-surface.md` and update:
- `renameSlug()` throws table: replace `Error('Slug already in use: …')` with `SlugConflictError`.
- Add `SlugConflictError` to the exports section.
- `handleRenameProject` description: update catch block description.
- Bump version/changelog marker for v1.9.4.

---

## Rationale

- **Pre-check over catch widening:** Prevents an unnecessary storage call for a known no-op; keeps the catch block semantically clean (it only catches conflict errors from actual rename attempts).
- **`SlugConflictError` in `ledger-store.ts`:** No new file is warranted for a single error class with one consumer; co-location with the thrower matches the existing codebase pattern.
- **Single WP:** All three code changes are two-to-five line edits in the same two files. Splitting them across work packages would produce unnecessary overhead.

---

## Detailed Steps

1. **Open `mcp-server/src/storage/ledger-store.ts`.**
   - Add `export class SlugConflictError extends Error` at module scope (before the `LedgerStore` class declaration).
   - In `renameSlug()`, replace `throw new Error('Slug already in use: "${newSlug}".')` with `throw new SlugConflictError(newSlug)`.

2. **Open `mcp-server/gui/api.ts`.**
   - Import `SlugConflictError` from `'../src/storage/ledger-store.js'`.
   - In `handleRenameProject`, wrap the `if (newSlug !== undefined)` block: replace the existing `try { latestMeta = await store.renameSlug(newSlug) } catch …` with the same-slug pre-check (see Approach section above).
   - Update the `catch` block to use `err instanceof SlugConflictError` instead of `msg.startsWith('Slug already in use:')`.
   - Remove the `const msg = …` line that is no longer needed (if no other use remains in the catch block).

3. **Open `mcp-server/tests/gui/api.test.ts`.**
   - Import `SlugConflictError` if needed for negative tests (likely not — existing conflict test passes a distinct slug).
   - Add test: `{ slug: currentSlug }` → 200, `result.slug === currentSlug`, `result.last_updated` unchanged.
   - Add test: `{ title: 'Updated Title', slug: currentSlug }` → 200, `result.title === 'Updated Title'`, `result.slug === currentSlug`, all other fields unchanged.

4. **Run the test suite** (`npm test` in `mcp-server/`) to confirm all tests pass and the count increases by 2.

5. **Open `mcp-server/docs/agents/project-manifest/api-surface.md`.**
   - Replace the "Known limitation" block for the same-slug no-op with a note that same-slug is a silent no-op returning current state.
   - Update the `renameSlug()` throws table row for `'Slug already in use'` to reference `SlugConflictError`.
   - Add `SlugConflictError` to the exports list.
   - Update `handleRenameProject` catch-block description.

6. **Open `mcp-server/changelog.md`.**
   - Add a v1.9.4 patch entry covering: same-slug no-op now returns 200, `SlugConflictError` typed class, 2 new API tests.

---

## Dependencies

- Completed: `LedgerStore.renameSlug()` implementation (v1.9.3 / `2026-03-05-independent-title-slug-rename`).
- Completed: `handleRenameProject` CONFLICT catch block (v1.9.3).
- No new external dependencies.

---

## Required Components

### Modified files
- `mcp-server/src/storage/ledger-store.ts` — add `SlugConflictError`; update `throw` in `renameSlug()`
- `mcp-server/gui/api.ts` — import `SlugConflictError`; add same-slug pre-check; update catch
- `mcp-server/tests/gui/api.test.ts` — 2 new tests (same-slug no-op; combined title + same-slug)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — remove known-limitation; update `renameSlug()` errors; add `SlugConflictError` export
- `mcp-server/changelog.md` — v1.9.4 patch entry

### New files
- None

---

## Assumptions

- `store.readProjectMeta()` is available on a `LedgerStore` instance constructed from the request slug — confirmed by its usage in existing tests and the `handleRenameProject` context (project existence is already verified via `store.ledgerDirExists()` before this point).
- The import path for `SlugConflictError` in `api.ts` follows the existing ESM pattern used for other `src/` imports (`.js` extension in the import specifier, resolved to `.ts` by `tsc`). Check the existing `LedgerStore` import in `api.ts` to confirm the exact specifier.
- Test count will increase from 1,107 to 1,109.

---

## Constraints

- Do not modify `renameSlug()`'s same-slug guard (`'Slug is already "…"; no rename needed.'`) — it is still correct at the storage layer and tested in `ledger-store.test.ts`. The API layer simply bypasses it via the pre-check.
- Do not touch `mcp-server/gui/public/app.js` — the client-side SLUG_REGEX already prevents same-slug submissions from the UI; the server-side fix is purely defensive.
- `noUnusedLocals: true` is enforced — ensure the `const msg = …` line is removed from the catch block if `SlugConflictError` instanceof check makes it unused.
- Atomic write discipline: no changes to the `atomicWriteJson` or `withLock` patterns.

---

## Out of Scope

- Adding `SlugConflictError` handling to the `LedgerStore.renameSlug()` same-slug guard (that throw remains a plain `Error`; the API pre-check makes it unreachable in normal usage).
- Client-side UI feedback for the same-slug case (the GUI's `SLUG_REGEX` already suppresses it; the fix is a server-side robustness improvement).
- A `src/utils/errors.ts` centralised error module — out of scope unless additional typed storage errors are introduced in the same work.
- Storage-layer tests for `SlugConflictError` — existing `ledger-store.test.ts` already asserts `/already in use/i` on the conflict case; updating it to check `instanceof SlugConflictError` is beneficial but not required for correctness.

---

## Acceptance Criteria

- `PATCH /api/projects/:slug { slug: <same-as-current-slug> }` returns HTTP 200 with the current project metadata (title, slug, `last_updated` all unchanged).
- `PATCH /api/projects/:slug { title: 'New Title', slug: <same-as-current-slug> }` returns HTTP 200 with the title updated and slug unchanged.
- `PATCH /api/projects/:slug { slug: <occupied-slug> }` still returns HTTP 409 `CONFLICT`.
- `SlugConflictError` is exported from `ledger-store.ts` and extends `Error`.
- The `handleRenameProject` catch uses `err instanceof SlugConflictError` (no remaining string-prefix matching for this case).
- The "Known limitation" entry for same-slug no-op is removed from `api-surface.md`.
- All 1,107 existing tests continue to pass; total count increases to at least 1,109.

---

## Testing Strategy

All verification is via the existing Vitest suite (`npm test` in `mcp-server/`). No new test infrastructure is needed. The two new test cases in `tests/gui/api.test.ts` directly exercise the fixed code path. The existing `CONFLICT` test (target slug occupied) confirms `SlugConflictError` is still caught and mapped correctly after the instanceof change.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`readProjectMeta()` call in the same-slug branch introduces a disk read that was not present before** | Acceptable: the project's existence is already confirmed via `ledgerDirExists()` earlier in the handler; the read is a single small JSON file and only occurs on the same-slug path, which is rare in practice. |
| **`noUnusedLocals` compile error if `const msg` is not removed** | The detailed steps explicitly call this out; the Engineer must remove `const msg = …` along with the `msg.startsWith(…)` condition. |
| **`SlugConflictError` import path is incorrect (ESM `.js` vs `.ts`)** | The Assumptions section flags this; the Engineer must verify the existing `LedgerStore` import specifier in `api.ts` and mirror it exactly. |
| **Storage-layer test still asserts string pattern, not type** | Not a risk for correctness — `/already in use/i` still matches `SlugConflictError`'s message. No test changes required in `ledger-store.test.ts`. |
