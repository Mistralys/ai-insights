# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Summary
Address the two production-critical items surfaced by the `2026-06-04-planner-project-history-access-rework-1` synthesis: (1) narrow the bare `catch {}` in `safeListRepositoryInsights` to suppress only slug-validation errors while surfacing genuine I/O failures, and (2) add a client-side slug sanitiser to the "Register" button pre-fill in the Strategy GUI.

## Architectural Context

### `safeListRepositoryInsights` (MCP server)
- **File:** `mcp-server/src/tools/repository-context.ts` (lines 220–230)
- Called inside a `Promise.all` at line 164, alongside a global insights query.
- Internally calls `manager.listInsights({ scope: 'repository', repository_name: repoName })`.
- `listInsights` → `_loadInsights` → `repositoryStorePath(repoName)` → `_validateSlug(repoName)`.
- `_validateSlug` throws a plain `Error` with message prefix `"Invalid repository name:"`.
- `repositoryStorePath` also throws a plain `Error` for the reserved name `'global'`.
- These are the **only** errors that should be suppressed — both are slug-validation failures where graceful degradation (returning `[]`) is correct.
- Genuine I/O errors (`EACCES`, `EIO`, JSON corruption) should **not** be suppressed.

### "Register" button (Strategy GUI)
- **File:** `mcp-server/gui/public/views/strategy.js` (lines 123–149)
- `wireRegisterButtons()` reads `data-register-folder` (raw filesystem directory name) and sets it directly into `#new-repo-id`.
- `SLUG_REGEX` (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`) rejects dots, spaces, and other special chars.
- A client-side sanitiser is needed to transform the raw folder name into a valid slug before pre-filling.

## Approach / Architecture

### WP-1: Typed catch in `safeListRepositoryInsights`
Replace the bare `catch {}` with a catch that checks the error message for the known slug-validation pattern (`"Invalid repository name:"` or `"'global' is a reserved name"`). Re-throw all other errors. This preserves the graceful-degradation contract (Constraint 76) while surfacing genuine filesystem failures.

### WP-2: Client-side slug sanitiser for Register button
Add a `sanitiseSlug(raw)` helper inside `renderStrategyList` that:
1. Lowercases the input.
2. Replaces any character not matching `[a-z0-9_-]` with `-`.
3. Strips leading non-alphanumeric characters.
4. Collapses consecutive hyphens.
5. Returns the sanitised string (or the original if already valid).

Apply this to the `#new-repo-id` pre-fill only — the label and folders fields keep the raw name since they have no regex constraint.

## Rationale
- **Typed catch:** The synthesis flagged this as the highest-risk production issue. Three independent agents (Developer, QA, Reviewer) agreed the bare catch hides genuine I/O failures. The fix is minimal, backward-compatible, and doesn't change the happy-path behavior.
- **Slug sanitiser:** Prevents a confusing `VALIDATION_ERROR` for any user whose ledger root contains directories with dots, spaces, or special characters. The fix is purely client-side and requires no API changes.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Error discrimination in catch | Message-prefix string match | Custom error class; ZodError check; error code property | The thrown errors are plain `Error` instances from `_validateSlug()` — no Zod involved. A custom error class would require changing `knowledge-store.ts` (larger scope). String-prefix match is sufficient and scoped to this function. |
| Sanitiser location | Inline helper in `renderStrategyList` | Shared utility in `api-client.js`; server-side sanitisation | The sanitiser is a pure UI convenience — the server must still reject invalid slugs. Placing it inline follows the existing module-less SPA pattern (per synthesis observation #5). No new shared module needed for a single call site. |

## Pattern Alignment
- **Constraint 76 (Graceful Degradation):** The typed catch continues to honour the fallback contract — slug failures still return `[]`. The only change is that non-slug errors are no longer swallowed. Documented as a narrowing of the existing `@remarks` block.
- **GUI SPA module-less pattern** (`mcp-server/gui/public/views/strategy.js`): The sanitiser is added as a local helper function inside `renderStrategyList`, consistent with the existing `buildToggleHtml`, `buildTableHtml`, `refreshTable`, `wireRegisterButtons`, `wireToggle` nesting pattern.

## Detailed Steps

### Step 1: Narrow `safeListRepositoryInsights` catch
1. In `mcp-server/src/tools/repository-context.ts`, replace the bare `catch {}` with a catch block that:
   - Checks if the error is an `Error` instance with a message starting with `"Invalid repository name:"` or `"'global' is a reserved name"`.
   - If yes: return `[]` (existing graceful degradation).
   - If no: re-throw the error (surfaces genuine I/O failures).
2. Update the JSDoc `@remarks` block to reflect the narrowed catch semantics.

### Step 2: Add slug sanitiser to `wireRegisterButtons`
1. In `mcp-server/gui/public/views/strategy.js`, inside `renderStrategyList`, add a `sanitiseSlug(raw)` helper function.
2. In `wireRegisterButtons`, apply `sanitiseSlug(folderName)` to the `idInput.value` assignment.
3. Keep `labelInput.value` and `foldersInput.value` as the raw `folderName` (no constraint on those fields).
4. Remove the `/* NOTE: ... */` comment block that documents the known gap (it's now fixed).

### Step 3: Add tests for narrowed catch
1. In `mcp-server/tests/tools/repository-context.test.ts`, add a test case that verifies `safeListRepositoryInsights` re-throws genuine errors (e.g., mock `listInsights` to throw a generic I/O error).
2. Add a test case that verifies it still returns `[]` for a slug-validation error.

### Step 4: Add test for slug sanitiser
1. No automated test infrastructure exists for the GUI `.js` files (vanilla JS, no bundler, no test runner). Document the manual verification steps instead.

## Dependencies
- None. Both changes are independent and backward-compatible.

## Required Components
- `mcp-server/src/tools/repository-context.ts` — narrow catch logic
- `mcp-server/gui/public/views/strategy.js` — sanitiser helper + pre-fill fix
- `mcp-server/tests/tools/repository-context.test.ts` — new test cases

## Assumptions
- The error messages thrown by `_validateSlug` and `repositoryStorePath` are stable and will not change without a corresponding update to this catch guard.
- The GUI has no automated test framework; manual verification is acceptable for client-side JS changes.

## Constraints
- Must not change the public API of `safeListRepositoryInsights` (still returns `Promise<Insight[]>`).
- Must not change the behavior when a valid slug is passed (no regression).
- Must not modify `knowledge-store.ts` (keep this change scoped to the consumer).
- Sanitiser must produce valid `SLUG_REGEX` output for any input folder name.

## Out of Scope
- Introducing a custom error class for slug validation (larger refactor).
- Adding a test runner for the GUI JavaScript files.
- `KnowledgeStoreManager` caching (deferred, negligible at current scale).
- `Promise.all` fan-out for `handleListRepos` (deferred, correct at current scale).
- `buildQueryString()` helper extension (deferred, no correctness impact).

## Acceptance Criteria
1. `safeListRepositoryInsights` returns `[]` when called with a repo name that fails `SLUG_REGEX` (e.g., `"../"`, `"has space"`, `"dot.name"`).
2. `safeListRepositoryInsights` returns `[]` when called with the reserved name `"global"`.
3. `safeListRepositoryInsights` re-throws errors that are **not** slug-validation failures (e.g., `EACCES`, `EIO`, generic `Error("disk failure")`).
4. The "Register" button pre-fills `#new-repo-id` with a sanitised slug (lowercase, no special chars, no leading non-alphanumeric).
5. The "Register" button still pre-fills `#new-repo-label` and `#new-repo-folders` with the raw folder name.
6. Full test suite passes with zero regressions.
7. TypeScript compiles cleanly (`npm run build` in `mcp-server/`).

## Testing Strategy
- **Unit tests** for the narrowed catch: mock `KnowledgeStoreManager.listInsights` to throw different error types and verify the guard logic.
- **Manual verification** for the GUI sanitiser: trigger the Register button with a folder name containing dots/spaces and confirm the ID field is sanitised.

## Test Plan
- `mcp-server/tests/tools/repository-context.test.ts` — "safeListRepositoryInsights re-throws non-slug errors" — AC-3
- `mcp-server/tests/tools/repository-context.test.ts` — "safeListRepositoryInsights returns [] for invalid slug" — AC-1
- `mcp-server/tests/tools/repository-context.test.ts` — "safeListRepositoryInsights returns [] for reserved name 'global'" — AC-2
- Manual: "Register button sanitises folder name with dots" — AC-4
- Manual: "Register button preserves raw name in label/folders fields" — AC-5

## Documentation Updates
- `mcp-server/docs/agents/project-manifest/constraints.md` — Update Constraint 76 canonical example to reflect the narrowed catch semantics (no longer "all errors suppressed").
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Update the `repository-context.ts` annotation to note "typed catch for slug errors only" instead of "all errors suppressed".

## Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| **Error message format changes in `_validateSlug`** | The catch guard uses `startsWith` on well-defined prefixes. Add a code comment referencing `knowledge-store.ts` `_validateSlug` and `repositoryStorePath` as the source of these messages. |
| **Sanitiser produces empty string for pathological input** | Guard: if sanitised result is empty, fall back to `'repo'` as a placeholder. |
| **Re-thrown errors break the `Promise.all` in `getRepositoryContext`** | This is intentional — genuine I/O failures should surface as tool errors rather than being silently swallowed. The MCP error response path already handles thrown errors gracefully. |
