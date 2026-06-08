# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary
Address the actionable items from the `2026-06-04-planner-project-history-access-rework-2` synthesis: (1) introduce a typed `SlugValidationError` custom error class in `knowledge-store.ts` to replace brittle string-prefix matching in the `safeListRepositoryInsights` catch guard, (2) narrow the `makeManager` test stub to `Pick<KnowledgeStoreManager, 'listInsights'>` for type safety, and (3) add a source-level `_internal: test-only` comment for contributor clarity.

## Architectural Context

### Custom error class precedent
The codebase already uses custom error classes in two locations:
- `mcp-server/src/storage/ledger-store.ts` → `SlugConflictError extends Error` (thrown when a slug is already in use during rename)
- `mcp-server/src/gui/errors.ts` → `ApiError extends Error` (GUI REST layer errors with status codes)

Both follow the same pattern: extend `Error`, set `this.name` in the constructor, and provide a meaningful message. Consumers catch them via `instanceof`.

### Current slug validation flow
- `mcp-server/src/storage/knowledge-store.ts`:
  - `repositoryStorePath(repoName)` at line 63 throws `new Error("'global' is a reserved name…")` when `repoName === 'global'`
  - `_validateSlug(slug)` at line 518 throws `new Error('Invalid repository name: "…". Name must…')` when `!SLUG_REGEX.test(slug)`
- Both throw plain `Error` instances — the only distinguishing characteristic is the message prefix.

### Current catch guard
- `mcp-server/src/tools/repository-context.ts` lines 228–239:
  - `safeListRepositoryInsights()` catches errors and checks `message.startsWith('Invalid repository name:')` or `message.startsWith("'global' is a reserved name")`.
  - This string-prefix matching is documented as intentional but acknowledged as technical debt.

### Constraint 76 (Graceful Degradation)
The `safeListRepositoryInsights` function fulfills Constraint 76 by returning `[]` for slug-validation failures while re-throwing genuine I/O errors. The typed error class replaces the catch mechanism but preserves the same contract.

### Test infrastructure
- `mcp-server/tests/tools/repository-context.test.ts` at line 591: `makeManager` creates a stub typed as `InstanceType<typeof KnowledgeStoreManager>` using `as any`.
- 7 existing tests validate the narrowed catch behavior and will need updating to throw `SlugValidationError` instead of plain `Error`.

## Approach / Architecture

### 1. New `SlugValidationError` class (co-located with `KnowledgeStoreManager`)
Define a custom error class in `mcp-server/src/storage/knowledge-store.ts` that extends `Error`. It holds the invalid slug value as a property for diagnostic use. Both `repositoryStorePath()` and `_validateSlug()` throw this class instead of plain `Error`.

### 2. Update catch guard to use `instanceof`
Replace the two `message.startsWith(…)` checks in `safeListRepositoryInsights` with a single `err instanceof SlugValidationError` check. This eliminates the message-coupling debt entirely.

### 3. Test updates
- Update `makeManager` test stubs to throw `SlugValidationError` for slug-validation test cases and plain `Error` for I/O error test cases.
- Narrow `makeManager` return type from `as any` to `Pick<KnowledgeStoreManager, 'listInsights'> as any` → actually, since `safeListRepositoryInsights` expects a `KnowledgeStoreManager` parameter (full type), the narrowing should be `as unknown as KnowledgeStoreManager` — or better, use `Pick<KnowledgeStoreManager, 'listInsights'>` with the function signature accepting the narrowed type. Given `safeListRepositoryInsights` takes `manager: KnowledgeStoreManager`, the cleanest approach is `as Pick<KnowledgeStoreManager, 'listInsights'> as unknown as KnowledgeStoreManager` — but that's ugly. The practical fix: type the stub as `{ listInsights: ... } as unknown as KnowledgeStoreManager`, which is marginally better than `as any` because it at least structurally checks the stub shape.

### 4. Source-level `_internal` comment
Add a brief inline comment above the `_internal` export in `repository-context.ts`.

## Rationale
- **Typed error over string matching:** `instanceof` is the idiomatic TypeScript mechanism for discriminating error types. It is immune to message string changes (the root cause of the coupling debt) and is how the rest of the codebase handles domain errors (`SlugConflictError`, `ApiError`).
- **Co-location in `knowledge-store.ts`:** The error is thrown by methods of `KnowledgeStoreManager` and semantically belongs to the knowledge-store domain. Placing it in the same file keeps the throw site and class definition together, matching the `SlugConflictError` pattern in `ledger-store.ts`.
- **Narrowed test stub:** The `as any` suppresses all type checking on the stub. Using a typed stub ensures the test breaks if the `listInsights` signature changes.
- **Source-level `_internal` comment:** Contributors reading the source cold should know the export is test-only without needing to consult `api-surface.md`.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Error class location | Co-located in `knowledge-store.ts` | Separate `errors.ts` in `src/storage/`; shared `src/errors/` directory | Single call site + single consumer makes co-location simpler; a shared errors module is overkill for one class. If more domain errors appear in storage, extraction can happen then. |
| Error class hierarchy | Single `SlugValidationError` for both reserved-name and regex-failure cases | Separate `ReservedNameError` + `InvalidSlugError` subclasses | Both are slug-validation failures with the same handling (return `[]`). Two classes doubles the surface area for zero behavioral benefit. The `slug` property on the error provides enough diagnostic context. |
| Catch guard shape | `err instanceof SlugValidationError` | Keep string matching as a fallback alongside `instanceof` | Mixed strategies increase cognitive load. Once the error class exists, all throw sites use it — no backwards-compatibility concern since the class and consumers are in the same package. |
| Test stub typing | `as unknown as KnowledgeStoreManager` | `Pick<KnowledgeStoreManager, 'listInsights'>` as parameter type | Changing the `safeListRepositoryInsights` parameter type to accept a `Pick<>` would be a signature change to production code just for test ergonomics. The `as unknown as KnowledgeStoreManager` pattern is standard for partial test stubs. |

## Pattern Alignment
- **Custom error class pattern:** Follows `SlugConflictError` in `mcp-server/src/storage/ledger-store.ts` (same constructor shape: extend `Error`, set `this.name`, accept domain value as constructor arg).
- **`_internal` test export pattern:** Follows existing convention in `repository-context.ts` and other tool files. The added comment aligns with the `@internal` JSDoc tag already present.
- **Constraint 76 compliance:** Preserved — `safeListRepositoryInsights` continues to return `[]` for slug-validation failures.
- **No departure from existing patterns.** All changes follow established conventions.

## Detailed Steps

1. **Define `SlugValidationError` in `knowledge-store.ts`:**
   - Add a new exported class `SlugValidationError extends Error` at the top of the file (after imports, before `KnowledgeStoreManager`).
   - Constructor accepts `slug: string` and `reason: string` (e.g. `'invalid_characters'` or `'reserved_name'`).
   - Set `this.name = 'SlugValidationError'`.
   - Store `slug` as a public readonly property for diagnostic use.

2. **Update `repositoryStorePath()` to throw `SlugValidationError`:**
   - Replace `throw new Error("'global' is a reserved name…")` with `throw new SlugValidationError('global', 'reserved_name')`.
   - The human-readable message is generated by the constructor (same text, just produced internally).

3. **Update `_validateSlug()` to throw `SlugValidationError`:**
   - Replace `throw new Error('Invalid repository name: "…"…')` with `throw new SlugValidationError(slug, 'invalid_characters')`.

4. **Update `safeListRepositoryInsights` catch guard in `repository-context.ts`:**
   - Import `SlugValidationError` from `'../storage/knowledge-store.js'`.
   - Replace the message-startsWith checks with `if (err instanceof SlugValidationError) { return []; }`.
   - Update the JSDoc `@remarks` to reference `SlugValidationError` instead of message prefixes.

5. **Update test file `repository-context.test.ts`:**
   - Import `SlugValidationError` from `'../../src/storage/knowledge-store.js'`.
   - Change `makeManager` to throw `new SlugValidationError(slug, reason)` for slug-validation test cases.
   - Change `makeManager` return type from `as any` to `as unknown as KnowledgeStoreManager`.
   - Verify that I/O error tests still throw plain `Error` (no change needed for those).
   - Update test descriptions if needed to reference the typed error.

6. **Verify `_internal` comment in `repository-context.ts`:**
   - A `/** @internal — exported for unit testing only. … */` JSDoc block already exists above the `_internal` export (confirmed by audit). No action required — AC is already satisfied by existing code.

7. **Add unit tests for `SlugValidationError` in `knowledge-store.test.ts`:**
   - Verify `instanceof Error` is true.
   - Verify `error.name === 'SlugValidationError'`.
   - Verify `error.slug` holds the provided value.
   - Verify `error.message` contains useful diagnostic text.

8. **Run full test suite and TypeScript build to confirm zero regressions.**

## Dependencies
- No external dependencies. All changes are internal to `mcp-server/`.
- Steps 4–5 depend on steps 1–3 (the error class must exist before consumers can import it).

## Required Components
- `mcp-server/src/storage/knowledge-store.ts` — new `SlugValidationError` class + updated throw sites
- `mcp-server/src/tools/repository-context.ts` — updated catch guard + import
- `mcp-server/tests/tools/repository-context.test.ts` — updated stubs + import
- `mcp-server/tests/storage/knowledge-store.test.ts` — new tests for `SlugValidationError`
- `mcp-server/tests/gui/knowledge-repository-scope.test.ts` — existing string-based `.toThrow()` assertion passes without modification provided the `SlugValidationError` constructor preserves the original message text verbatim; optionally update to `toThrow(SlugValidationError)` for a stronger type-based guarantee

## Assumptions
- `_validateSlug()` and `repositoryStorePath()` are the **only** places that throw slug-validation errors consumed by `safeListRepositoryInsights`. Verified by tracing the call path: `listInsights` → `_loadInsights` → `repositoryStorePath` → `_validateSlug`.
- No other catch site in the codebase relies on the error message text of these two throw statements. Verified: `grep` found only `repository-context.ts` as a consumer.
- The `KnowledgeStoreManager` class is not extended/subclassed anywhere (it's final in practice). Changing its throw types is safe.

## Constraints
- Must not break Constraint 76 (Graceful Degradation): `safeListRepositoryInsights` must continue returning `[]` for invalid slugs.
- Must not modify the `SLUG_REGEX` pattern or the validation logic — only the error throwing mechanism changes.
- Must not add external dependencies.

## Out of Scope
- `sanitiseSlug` extraction in `strategy.js` (no second call site exists — per synthesis).
- GUI test harness for `strategy.js` (conditional on above).
- Changing the `safeListRepositoryInsights` function signature to accept a narrower type.
- Adding typed errors for other `KnowledgeStoreManager` failure modes (e.g. "insight not found") — that's a separate cleanup scope.

## Acceptance Criteria
- `SlugValidationError` class is exported from `knowledge-store.ts` and thrown by both `repositoryStorePath()` and `_validateSlug()`.
- `safeListRepositoryInsights` catches via `instanceof SlugValidationError` with no string-matching logic remaining.
- All 7 existing `safeListRepositoryInsights` tests pass (updated to throw the typed error).
- New tests verify `SlugValidationError` shape and behavior.
- `makeManager` test stub no longer uses `as any`.
- `_internal` export has a source-level comment clarifying its test-only nature (already satisfied by existing `@internal` JSDoc — no new comment needed).
- Full test suite passes with zero failures.
- TypeScript build (`tsc`) completes cleanly.

## Testing Strategy
Unit tests only. The change is confined to error-type discrimination in a single catch block and the throw sites that feed it. No integration or E2E testing is needed because:
- The functional behavior is unchanged (same inputs → same outputs).
- The existing 7 tests cover all discriminated paths; they merely need to throw the typed error instead of a plain `Error`.
- New tests verify the `SlugValidationError` class contract.

## Test Plan

- `mcp-server/tests/storage/knowledge-store.test.ts` — New describe block `SlugValidationError`: assert `instanceof Error`, assert `error.name === 'SlugValidationError'`, assert `error.slug` property, assert message contains slug value — covers AC: "SlugValidationError shape and behavior"
- `mcp-server/tests/storage/knowledge-store.test.ts` — 9 existing `repositoryStorePath` tests (1 reserved-name at L68–70; 8 parametric path-traversal at L74–88) plus 1 `addInsight` test (L270) use string-based `.toThrow(message)` assertions. These pass without modification because the `SlugValidationError` constructor preserves the original message text. Optionally update them to `toThrow(SlugValidationError)` for stronger type-based guarantees — covers AC: "thrown by both methods"
- `mcp-server/tests/gui/knowledge-repository-scope.test.ts` — Existing test (L87–88) calls `repositoryStorePath('global')` and asserts `.toThrow("'global' is a reserved name…")`. Passes without modification provided the constructor message is verbatim. Optionally update to `toThrow(SlugValidationError)` — covers AC: "thrown by both methods"
- `mcp-server/tests/tools/repository-context.test.ts` — Update 4 slug-validation tests to throw `new SlugValidationError(…)` instead of `new Error(…)` — covers AC: "instanceof catch works"
- `mcp-server/tests/tools/repository-context.test.ts` — 3 I/O error tests remain unchanged (throw plain `Error`) — covers AC: "re-throws genuine errors"
- `mcp-server/tests/tools/repository-context.test.ts` — Verify `makeManager` uses `as unknown as KnowledgeStoreManager` — covers AC: "no `as any`"
- Full suite run (`npm test` in `mcp-server/`) — covers AC: "zero failures"
- TypeScript build (`npx tsc --noEmit` in `mcp-server/`) — covers AC: "clean build"

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Add `SlugValidationError` class to the Storage section (constructor signature, exported properties); update `safeListRepositoryInsights` entry to reference `instanceof` instead of message-prefix matching.
- `mcp-server/docs/agents/project-manifest/file-tree.md` — No new files; update the `knowledge-store.ts` annotation to mention `SlugValidationError` export.
- `mcp-server/changelog.md` — Add entry for the typed error introduction.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Other code catches slug-validation errors by message text** | Verified by grep: only `repository-context.ts` matches. No other consumer exists. |
| **Downstream orchestrator Python code relies on error message format** | Orchestrator calls MCP tools via the MCP protocol — it sees tool error responses, not raw Error messages. The tool-level error message in `getRepositoryContext` is constructed from `(error as Error).message` on the outer catch (line 203), not the inner `safeListRepositoryInsights` catch. No impact. |
| **`SlugValidationError` accidentally caught by a broader `instanceof Error` check** | `SlugValidationError extends Error` is intentional — it should be caught by generic error handlers. The specific `instanceof SlugValidationError` check in `safeListRepositoryInsights` runs first and returns `[]` before the error can propagate. |
| **Forgotten throw site still uses plain `Error`** | Only two throw sites exist for slug validation (line 64 and line 518 in `knowledge-store.ts`). Both are updated in step 2 and step 3. The existing tests will fail if a plain `Error` is thrown instead (they now construct `SlugValidationError` in the stub). |
| **Existing tests rely on verbatim error message text** | 9 tests in `knowledge-store.test.ts` and 1 in `knowledge-repository-scope.test.ts` use string-based `.toThrow(message)`. The `SlugValidationError` constructor must produce the same message text as the original `new Error(…)` calls. This is enforced by the new `SlugValidationError` unit tests that assert message content. |
