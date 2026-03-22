# Plan

## Summary

This rework plan implements all actionable strategic recommendations from the `2026-02-28-ledger-document-archiving` synthesis report. The work covers four targeted improvements: extracting shared archive filename constants (Rec 1), hardening `archiveDocuments()` error classification (Rec 2), adding slug path-traversal sanitization to all slug-accepting GUI API handlers (Rec 3), and documenting the route insertion order constraint in `server.ts` (Rec 4). Recommendation 5 (version annotation for `marked.min.js`) is already satisfied — the vendored file's header already reads `marked v15.0.12 – a markdown parser`; no action is required.

---

## Architectural Context

### MCP Server sub-project

The changes are confined to the `mcp-server/` sub-project. The relevant modules and their roles:

| File | Role |
|------|------|
| `mcp-server/src/utils/constants.ts` | Single source of truth for shared string constants — currently exports `AGENT_ROLES` and `AgentRole`; the new filename constants live here |
| `mcp-server/src/storage/ledger-store.ts` | `LedgerStore` class; `archiveDocuments()` at line 288 catches all errors uniformly |
| `mcp-server/src/tools/project-lifecycle.ts` | `initializeProject` (passes `args.plan_file`) and `completeSynthesis` (Zod `.default('synthesis.md')` at line 381) call `archiveDocuments` |
| `mcp-server/src/tools/help-content.ts` | Inline example string `"plan.md"` at line 138; `"synthesis.md"` at lines 581-582, 602 |
| `mcp-server/gui/api.ts` | Five slug-accepting handlers (`handleGetProject`, `handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`, `handleGetPlanDocument`); hardcoded `'plan.md'` at line 385 |
| `mcp-server/gui/server.ts` | Manual route dispatcher using length-based segment matching; ordering comment belongs here |
| `mcp-server/tests/storage/ledger-store.test.ts` | Unit tests for `archiveDocuments()` |
| `mcp-server/tests/gui/api.test.ts` | Unit tests for GUI API handlers |

### Key patterns

- **Constants pattern:** New constants follow the `export const NAME = 'value' as const;` style already in `constants.ts`.
- **Error handling:** The codebase uses typed guard re-throws for unexpected errors; non-`ENOENT` errors from `archiveDocuments()` should be re-thrown so callers observe the failure.
- **Slug sanitization:** No existing handler currently sanitizes the `slug` parameter. The fix is a shared one-line guard function that all five slug-accepting handlers call before any filesystem operation.
- **Router dispatch:** `server.ts` uses a manual if-else chain. Routes are disambiguated by `rest.length`, so the `/:slug/plan` (length=3) handler and the `/:slug` (length=2) handler cannot conflict with each other. However, two handlers at the same length (e.g., future `/:slug/synthesis`) would silently shadow each other if added after the matched case. An inline comment calling this out is warranted.

---

## Approach / Architecture

### Rec 1 — Filename Constants

Add two new exports to `mcp-server/src/utils/constants.ts`:

```typescript
export const PLAN_ARCHIVE_FILENAME     = 'plan.md'       as const;
export const SYNTHESIS_ARCHIVE_FILENAME = 'synthesis.md' as const;
```

Import and replace every hardcoded occurrence:

- `gui/api.ts` line 385: `'plan.md'` → `PLAN_ARCHIVE_FILENAME`
- `src/tools/project-lifecycle.ts` line 381 Zod `.default(...)`: `'synthesis.md'` → `SYNTHESIS_ARCHIVE_FILENAME`
- `src/tools/help-content.ts`: both inline example strings

Note: `plan_file` in `initializeProject` is a _caller-supplied_ parameter, not a hardcoded default — no change needed there. The constant replaces only the read-side literal in `gui/api.ts` and the Zod default in `completeSynthesis`.

### Rec 2 — ENOENT Discrimination in `archiveDocuments()`

Refine the catch block in `LedgerStore.archiveDocuments()`:

```typescript
} catch (err: unknown) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    console.error(`[project-ledger-mcp] Archive skipped (source not found): ${src}`);
    skipped.push(filename);
  } else {
    throw err; // unexpected I/O error — do not silently swallow
  }
}
```

This preserves the existing benign-skip behavior for missing source files while surfacing real I/O failures (permission denied, disk full) to the caller, who can observe them and decide how to respond.

### Rec 3 — Slug Sanitization

Introduce a private helper (or inline pattern) in `gui/api.ts`:

```typescript
function assertSafeSlug(slug: string): void {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    notFound(`Invalid project slug: '${slug}'.`);
  }
}
```

Call `assertSafeSlug(slug)` as the first statement in all five slug-accepting handlers:

- `handleGetProject`
- `handleListWorkPackages`
- `handleGetWorkPackage`
- `handleDeleteProject`
- `handleGetPlanDocument`

Using `notFound()` (HTTP 404) keeps the response consistent with the existing error vocabulary; it also avoids leaking path-traversal details in error messages.

### Rec 4 — Route Ordering Comment in `server.ts`

Add a block comment above the routing section in `gui/server.ts` that explains the length-based disambiguation model and the ordering requirement for same-length routes:

```typescript
// Route dispatch note:
// Routes are matched by segment count (rest.length) first, then by segment values.
// Sub-resource routes (rest.length === 3, e.g. /:slug/plan) must be registered
// BEFORE the generic /:slug handler (rest.length === 2); otherwise they would
// never match. When adding a new sub-resource at the same depth as an existing one,
// ensure it is inserted before any catch-all handler at the same length.
```

---

## Rationale

- **Rec 1** eliminates silent coupling: three independent call sites currently share the same string with no link. A refactor-time filename rename would require a multi-file grep; with constants it's a single-line change.
- **Rec 2** follows the principle of least surprise: catching all errors and treating them as "skipped" hides real failures. The discriminated catch preserves the benign-skip UX while propagating unexpected errors to the test suite and to callers.
- **Rec 3** follows defence-in-depth: the GUI server is internal-only today but the traversal risk is real and the fix is trivial. Consistency across all five handlers avoids partial protection.
- **Rec 4** prevents a whole class of routing bugs for future contributors with no runtime cost.
- **Rec 5 is already done.** The vendored `marked.min.js` header already contains `marked v15.0.12 — a markdown parser`. No work is required.

---

## Detailed Steps

1. **Add filename constants to `constants.ts`**
   - Append `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` exports.

2. **Replace hardcoded `'plan.md'` in `gui/api.ts`**
   - Import `PLAN_ARCHIVE_FILENAME` from `constants.ts`.
   - Replace the literal on line 385.

3. **Replace hardcoded `'synthesis.md'` in `project-lifecycle.ts`**
   - Import `SYNTHESIS_ARCHIVE_FILENAME` from `constants.ts`.
   - Replace the Zod `.default('synthesis.md')` value.

4. **Replace hardcoded strings in `help-content.ts`**
   - Import both constants.
   - Replace the inline example strings (lines 138, 581–582, 602).

5. **Harden `archiveDocuments()` in `ledger-store.ts`**
   - Replace the blanket catch with the ENOENT-discriminating variant.
   - Update the JSDoc comment to reflect the new behavior.

6. **Add `assertSafeSlug()` helper in `gui/api.ts`**
   - Add the non-exported helper function near the top of the handler section.
   - Insert `assertSafeSlug(slug)` as the first line in all five slug-accepting handlers.

7. **Add routing comment to `server.ts`**
   - Insert the block comment above the top-of-routing-block, before the first `if (method === 'GET'...)` check.

8. **Update unit tests for `archiveDocuments()`**
   - Add a test case: non-`ENOENT` error (e.g., `EACCES`) is re-thrown rather than silently skipped.

9. **Add unit tests for slug sanitization**
   - In `tests/gui/api.test.ts`, add test cases for each affected handler: `slug = '../etc/passwd'` and `slug = 'foo/bar'` should return 404.

10. **Update manifest documents**
    - `api-surface.md`: update `archiveDocuments()` return/error semantics; note `assertSafeSlug()` as internal helper; update `PLAN_ARCHIVE_FILENAME` / `SYNTHESIS_ARCHIVE_FILENAME` constants table.
    - `constraints.md`: add slug sanitization rule; extend the archive error contract.

---

## Dependencies

- No new npm dependencies.
- `constants.ts` must be compiled before any file that imports the new constants; `tsc` handles this automatically via the project's single-pass compile.
- Test changes depend on the implementation changes (steps 5 and 6) being in place first.

---

## Required Components

| File | Change Type |
|------|-------------|
| `mcp-server/src/utils/constants.ts` | Modified — add 2 new exports |
| `mcp-server/src/tools/project-lifecycle.ts` | Modified — import + use `SYNTHESIS_ARCHIVE_FILENAME` |
| `mcp-server/src/tools/help-content.ts` | Modified — import + use both filename constants |
| `mcp-server/gui/api.ts` | Modified — import `PLAN_ARCHIVE_FILENAME`; add `assertSafeSlug()`; apply to 5 handlers |
| `mcp-server/gui/server.ts` | Modified — add routing order comment |
| `mcp-server/src/storage/ledger-store.ts` | Modified — discriminate ENOENT in `archiveDocuments()` |
| `mcp-server/tests/storage/ledger-store.test.ts` | Modified — add ENOENT-vs-EACCES test case |
| `mcp-server/tests/gui/api.test.ts` | Modified — add slug sanitization test cases |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Modified — reflect constant names, `assertSafeSlug`, ENOENT behavior |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Modified — slug sanitization rule + archive error contract |

---

## Assumptions

- `constants.ts` is the canonical home for shared string constants in the MCP server. The import chain from `gui/api.ts` into `src/utils/constants.ts` is already established (see the existing `LedgerStore` import pattern from `gui/api.ts` → `src/storage/ledger-store.ts`).
- `assertSafeSlug` is kept non-exported (internal to `gui/api.ts`) since it is a pure defensive guard with no value as a public API.
- The ENOENT discrimination in `archiveDocuments()` should re-throw non-`ENOENT` errors rather than returning them in the `skipped` array, to match how the rest of the codebase handles unexpected I/O failures.
- `help-content.ts` inline example strings are human-visible documentation strings, not code paths that need runtime constants — however, replacing them with constants is still preferable for consistency and to prevent the documentation from drifting from the code.

---

## Constraints

- All existing 529 tests must continue to pass at the end of all work packages.
- No behavioral changes to the MCP tools' external interfaces (Zod schemas, route signatures, response shapes).
- The `assertSafeSlug` guard must respond with 404 (not 400 or 500) to maintain API consistency.
- The `archiveDocuments()` method signature and return type (`{ archived, skipped }`) must not change — only the internal error handling path changes.

---

## Out of Scope

- Adding sanitization to the MCP tool layer (the `slug` type in `project-meta.ts` Zod schema already constrains slugs at validation time).
- Migrating the inline example strings in `help-content.ts` to a separate configuration or template system.
- Updating the orchestrator or personas sub-projects (no inter-project dependencies are affected).
- Adding a `marked.version` file alongside the vendored library (the version is already captured in the file header and in `api-surface.md`; further annotation would be redundant).

---

## Acceptance Criteria

- `PLAN_ARCHIVE_FILENAME` and `SYNTHESIS_ARCHIVE_FILENAME` are exported from `constants.ts` and all previously-hardcoded occurrences of `'plan.md'` (read-side) and `'synthesis.md'` (default-side) import and use these constants.
- `archiveDocuments()` re-throws any error that is not `ENOENT`; `ENOENT` errors continue to be silently skipped and logged.
- A new test verifies that `archiveDocuments()` with a permission-error mock re-throws rather than skipping.
- All five slug-accepting handlers in `gui/api.ts` call `assertSafeSlug(slug)` before any filesystem operation.
- New tests confirm that `'../traversal'` and `'foo/bar'` slugs return 404 from at least `handleGetProject` and `handleGetPlanDocument`.
- `server.ts` contains the routing order comment above the dispatch block.
- `api-surface.md` and `constraints.md` are updated to reflect all changes.
- All existing tests (≥ 529) still pass; suite does not regress.

---

## Testing Strategy

- **Unit — `ledger-store.test.ts`:** Add one test: mock `copyFile` to throw `{ code: 'EACCES' }`; assert `archiveDocuments` re-throws rather than returning the file in `skipped`.
- **Unit — `api.test.ts`:** Add test cases for `handleGetProject` and `handleGetPlanDocument` with malformed slugs (`'..%2Fetc'`, `'../etc'`, `'foo/bar'`); assert HTTP 404. Remaining three handlers (`handleListWorkPackages`, `handleGetWorkPackage`, `handleDeleteProject`) can be covered by a single representative test each to avoid over-specifying.
- **Compile-time:** `npx tsc --noEmit` confirms all constant imports resolve correctly.
- **Regression:** `npm test` in `mcp-server/` must report ≥ 529 passing, 0 failing.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`assertSafeSlug` pattern is too aggressive** — a valid slug containing a `/`-encoded segment could be rejected | URL-decoded slugs never contain literal `/`; `encodeURIComponent` in the SPA encodes `/` to `%2F` before sending; the raw `slug` from `rest[1]` in `server.ts` is the URL-decoded path segment, which should never contain `/` for a well-formed slug |
| **Importing `constants.ts` from `gui/api.ts` breaks module resolution** | `gui/api.ts` already imports from `../src/storage/ledger-store.js` — the same `../src/` path prefix works for `../src/utils/constants.js`; no new module boundary is crossed |
| **Re-throwing in `archiveDocuments()` breaks an existing test** | The 4 existing tests only simulate `ENOENT`-style skips; none simulate non-`ENOENT` errors. Re-throw behavior is additive and does not affect existing test paths |
| **`help-content.ts` string replacements introduce template inconsistencies** | The strings in `help-content.ts` are interpolated into multi-line template literals; importing constants and interpolating them (`${PLAN_ARCHIVE_FILENAME}`) is idiomatic TypeScript and will produce identical output |
