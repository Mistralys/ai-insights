# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.4.0
- Architectural Reviews: none — Plan Architect Reviewer v1.5.0

## Summary

This rework plan addresses all actionable items surfaced in the synthesis report for
`2026-05-29-knowledge-repository-scope`. Two medium-priority API handler hardening issues
are the primary focus: (1) `handleDeleteKnowledge` and `handlePromoteKnowledge` return
HTTP 500 instead of HTTP 400 for malformed `repository_name` values because they lack a
handler-level `PROJECT_SLUG_REGEX` guard; (2) `handleListKnowledge` silently ignores
invalid `scope` values (e.g. `'project'`) rather than returning a `VALIDATION_ERROR` as
all other handlers do. Four low-priority cleanup items round out the plan: rename
`PROJECT_SLUG_REGEX` → `SLUG_REGEX` across the MCP server (no external consumers confirmed;
the original name referenced the now-defunct `project` scope); rename the stale
`projectInsightId` test variable to `repositoryInsightId`; fix the `|| undefined`
pattern in `api-client.js` to use stricter `!= null` semantics; and verify the
`origin_plan` example coverage in `help-content.ts` (likely already resolved by WP-004).

---

## Architectural Context

The knowledge subsystem spans four layers across `mcp-server/`:

| Layer | Files |
|-------|-------|
| Schema (types + validation) | `src/schema/knowledge.ts` — `InsightScope`, `InsightSchema`, `PROJECT_SLUG_REGEX` (to be renamed `SLUG_REGEX`) |
| Storage (CRUD + file I/O) | `src/storage/knowledge-store.ts` — `KnowledgeStoreManager` |
| MCP tools (agent-facing API) | `src/tools/knowledge.ts` (tools), `src/tools/help-content.ts` (help strings) |
| GUI REST API | `gui/api-knowledge.ts` (handlers + schemas), `gui/server.ts` (routes) |
| GUI frontend | `gui/public/api-client.js`, `gui/public/views/knowledge.js` |

Five REST handler functions live in `gui/api-knowledge.ts` per the architectural
constraint in `constraints.md` §"Knowledge handlers must live in `gui/api-knowledge.ts`":
`handleListKnowledge`, `handleUpdateKnowledge`, `handleDeleteKnowledge`,
`handlePromoteKnowledge`, `handleMoveKnowledge`.

**Validation consistency baseline.** `handleMoveKnowledge` and `handleUpdateKnowledge`
validate `repository_name` via Zod (`z.string().regex(PROJECT_SLUG_REGEX)`) and return
HTTP 400 `VALIDATION_ERROR` for malformed slugs. `handleDeleteKnowledge` and
`handlePromoteKnowledge` accept `repository_name` as a raw string and pass it directly to
the storage layer, relying on `_validateSlug()` for safety — but `_validateSlug()` throws
a generic `Error`, which propagates to the server's unhandled-error branch as HTTP 500.

**`handleListKnowledge` scope baseline.** All four mutating handlers use
`InsightScope.safeParse(scope)` and throw `VALIDATION_ERROR` if the parse fails.
`handleListKnowledge` also calls `InsightScope.safeParse(params.scope)` but maps a parse
failure to `undefined` (silently treats it as "no scope filter"). This inconsistency means
`scope: 'project'` returns all results from the list endpoint but a `VALIDATION_ERROR`
from every other endpoint.

**Test location.** Handler tests live in
`tests/gui/api-knowledge.test.ts` (unit + integration, real temp dirs).
The `knowledge-repository-scope.test.ts` suite covers end-to-end AC scenarios.

---

## Approach / Architecture

### Group A — Handler-level slug validation in delete and promote

Add an explicit `PROJECT_SLUG_REGEX` guard in both `handleDeleteKnowledge` and
`handlePromoteKnowledge`, immediately after the `repository_name`-presence check and
before calling `KnowledgeStoreManager`. This mirrors the existing Zod-regex pattern in
`handleUpdateKnowledge` and `handleMoveKnowledge` but is applied as an inline
`validationError()` call (matching the function-parameter-based signature of these two
handlers, which do not parse a body).

No schema changes. No storage changes. The fix is contained entirely to
`gui/api-knowledge.ts`.

After the fix, the file-level `@known-limitation` JSDoc block and the per-handler
"Defence-in-depth note" comments become inaccurate and must be updated.

### Group B — `handleListKnowledge` scope rejection

Change the fallback behaviour: if `params.scope` is a non-nullish string AND
`InsightScope.safeParse(params.scope)` fails, call `validationError()` instead of
returning `undefined`. When `params.scope` is absent or `undefined`, retain the
existing "no scope filter" behaviour unchanged.

This brings `handleListKnowledge` into alignment with all other handlers and fulfils
AC-17 (which requires `scope: 'project'` to be rejected by _all_ tools and handlers)
consistently. No schema, storage, or route changes required.

### Group C — Low-priority cleanup

1. **`projectInsightId` rename** — simple variable rename within the
   `ledger_update_insight` describe block in
   `tests/tools/knowledge.test.ts` (lines 392–482). No behavioural change.

2. **`api-client.js` `|| undefined` fix** — replace three occurrences of
   `repositoryName || undefined` and one of `sourceRepositoryName || undefined` with
   `repositoryName != null ? repositoryName : undefined` (and
   `sourceRepositoryName != null ? sourceRepositoryName : undefined`). This closes the
   edge-case where a repository named `'0'` would be incorrectly dropped. Frontend JS,
   no TypeScript compilation required.

3. **`origin_plan` example verification** — the synthesis flagged that `origin_plan` was
   missing from the example JSON in `help-content.ts`. A read of the current file shows
   `origin_plan` is already present in the second (repository-scoped) example added by
   WP-004. The Engineer must confirm this during implementation; no code change is
   expected, but the `@known-limitation` comment for this item in
   `mcp-server/docs/agents/project-manifest/constraints.md` does not exist (the
   limitation was only in the synthesis). No constraint doc update required for this item.

---

## Rationale

- **Inline `validationError()` guard** (vs. adding `repository_name` to a Zod query
  schema): `handleDeleteKnowledge` and `handlePromoteKnowledge` receive `repository_name`
  as a plain function parameter (not a parsed body), matching their HTTP query-parameter
  origin. Introducing a query-body Zod schema would be a larger, riskier refactor for
  two otherwise simple handlers. A single `if (!PROJECT_SLUG_REGEX.test(repository_name))
  validationError(...)` guard is the smallest, lowest-risk fix and exactly matches the
  suggestion in the synthesis.

- **Reject any unrecognised scope in `handleListKnowledge`** (vs. only rejecting
  `'project'`): Rejecting any invalid string is semantically cleaner — callers should
  not rely on silent fallback for typos. The synthesis explicitly asks for consistency
  with the other four handlers, all of which reject any non-`InsightScope` string value.
  Absent scope (`undefined`) still means "no filter", preserving backward compatibility.

- **`!= null` over `|| undefined`**: `repository_name` values in practice are
  always non-empty strings or absent. The `'0'` edge case is real but harmless today
  because no repository can be named `'0'` (it would fail `PROJECT_SLUG_REGEX`). Still,
  using `!= null` is strictly more correct and removes the documented limitation note
  from the JSDoc in `api-client.js`.

---

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Slug guard in delete/promote | Inline `if (!PROJECT_SLUG_REGEX.test(...)) validationError(...)` | Zod query-param schema; delegating to a new helper | Inline guard is the smallest shape, matches existing `validationError()` call site pattern, and avoids a schema refactor for two otherwise-simple handlers |
| List scope validation | Throw VALIDATION_ERROR for any non-nullish unrecognised scope | Only reject `'project'` explicitly; keep silent-fallback for other unknowns | Rejecting any unrecognised scope is consistent with all other handlers and cleaner API contract; it does not break existing callers (who either pass no scope or a valid scope) |
| `|| undefined` fix in api-client.js | `!= null ? ... : undefined` | `=== null \|\| === undefined` explicit checks; lodash `_.isNil` | `!= null` is idiomatic JS for null/undefined coalescence; no dependency needed; symmetric with how the condition is described in the synthesis |

---

## Pattern Alignment

| Pattern | Source | This plan... |
|---------|--------|-------------|
| `validationError()` helper for HTTP 400 in handlers | `gui/api-knowledge.ts` → every handler | Follows — adds `validationError()` calls in delete/promote at the same point in the handler flow as existing checks |
| `InsightScope.safeParse()` + throw on failure | `handleDeleteKnowledge`, `handlePromoteKnowledge` | Follows — list handler adopts the same throw-on-failure pattern already used by the other four |
| Zod schema for body validation; inline guard for query params | `handleUpdateKnowledge` (Zod body) vs proposed change | Follows — query params in delete/promote are not wrapped in a Zod schema; inline guard matches the pattern used elsewhere for non-body string params |
| `PROJECT_SLUG_REGEX` import from `src/schema/knowledge.ts` | Already imported in `gui/api-knowledge.ts` line 48 | Follows — no new import required |

---

## Detailed Steps

1. **[Group A] Add `PROJECT_SLUG_REGEX` guard to `handleDeleteKnowledge`.**
   In `gui/api-knowledge.ts`, after the `repository_name`-presence check (line ~350) and
   before `new KnowledgeStoreManager(ledgerRoot)`, add:
   ```ts
   if (repository_name && !PROJECT_SLUG_REGEX.test(repository_name)) {
     validationError('repository_name contains invalid characters.');
   }
   ```
   `PROJECT_SLUG_REGEX` is already imported (line 48). The guard fires only when
   `repository_name` is truthy (i.e. when scope is `'repository'` — the presence check
   above already ensures it is non-empty when `scope === 'repository'`).

2. **[Group A] Add `PROJECT_SLUG_REGEX` guard to `handlePromoteKnowledge`.**
   Same pattern, same location in the handler flow (after the `!repository_name` presence
   check, before `new KnowledgeStoreManager`):
   ```ts
   if (!PROJECT_SLUG_REGEX.test(repository_name)) {
     validationError('repository_name contains invalid characters.');
   }
   ```
   In `handlePromoteKnowledge`, `repository_name` is guaranteed truthy at this point
   (the presence check above throws if absent), so no additional truthiness guard is
   needed.

3. **[Group A] Update `@known-limitation` comment block at the top of
   `gui/api-knowledge.ts`.**
   The file-level JSDoc block (lines 17–31) documents this as a `@known-limitation`.
   After the fix, rewrite that block to note that handler-level slug validation is now
   present in all five handlers — remove the "HTTP 500 rather than 400" statement and
   the "future hardening pass" guidance, replacing with a brief note confirming the fix.

4. **[Group A] Update per-handler "Defence-in-depth note" comments.**
   Both `handleDeleteKnowledge` and `handlePromoteKnowledge` contain a multi-paragraph
   "Defence-in-depth note" in their JSDoc explaining the HTTP 500 vs 400 issue. After
   the fix, replace each note with a short confirmation: "repository_name is validated
   against `PROJECT_SLUG_REGEX` before reaching the storage layer; malformed slugs return
   VALIDATION_ERROR (400)."

5. **[Group B] Fix `handleListKnowledge` scope validation.**
   In `gui/api-knowledge.ts`, replace:
   ```ts
   const scopeResult = InsightScope.safeParse(params.scope);
   const scope = scopeResult.success ? scopeResult.data : undefined;
   ```
   with:
   ```ts
   const scopeResult = InsightScope.safeParse(params.scope);
   if (params.scope !== undefined && !scopeResult.success) {
     validationError('scope must be "global" or "repository" when provided.');
   }
   const scope = scopeResult.success ? scopeResult.data : undefined;
   ```
   This rejects any explicitly-passed invalid scope (including `'project'`) while
   preserving the "no scope filter" behaviour when `params.scope` is absent.

6. **[Group B] Update `handleListKnowledge` JSDoc.**
   Update the JSDoc comment for `handleListKnowledge` to replace the line:
   > "unrecognised values are silently treated as 'no scope filter'"
   with:
   > "unrecognised values throw VALIDATION_ERROR; omitting `scope` returns all insights."

7. **[Group C] Rename `projectInsightId` → `repositoryInsightId`.**
   In `tests/tools/knowledge.test.ts`, rename the variable declared at line 392 and all
   three usages (lines 413, 474, 482) from `projectInsightId` to `repositoryInsightId`.
   This is a pure cosmetic rename with no behavioural change.

8. **[Group C] Fix `|| undefined` pattern in `gui/public/api-client.js`.**
   Replace four occurrences:
   - Line 139: `repositoryName || undefined` → `repositoryName != null ? repositoryName : undefined`
   - Line 159: `repositoryName || undefined` → `repositoryName != null ? repositoryName : undefined`
   - Line 182: `repositoryName || undefined` → `repositoryName != null ? repositoryName : undefined`
   - Line 208: `sourceRepositoryName || undefined` → `sourceRepositoryName != null ? sourceRepositoryName : undefined`
   Also update the corresponding JSDoc `@param` comments on lines 124–125, 147, 170 to
   remove the "falsy" language and instead say "null/undefined values are omitted."

9. **[Group C] Verify `origin_plan` example in `help-content.ts`.**
   Read `src/tools/help-content.ts` around the `ledger_add_insight` section. The current
   file (post-WP-004) already shows `origin_plan` in the repository-scoped JSON example
   (line 783). No code change required. If absent, add `"origin_plan":
   "2026-05-29-knowledge-repository-scope"` to the repository-scoped example.

10. **[Group A + B] Add handler tests.**
    In `tests/gui/api-knowledge.test.ts`, add the following test cases:
    - `handleDeleteKnowledge` with malformed `repository_name` (e.g. `'../evil'`,
      `'has spaces'`) → throws VALIDATION_ERROR (two test cases).
    - `handlePromoteKnowledge` with malformed `repository_name` → throws
      VALIDATION_ERROR (two test cases).
    - `handleListKnowledge` with `scope: 'project'` → throws VALIDATION_ERROR.
    - `handleListKnowledge` with `scope: 'bogus'` → throws VALIDATION_ERROR.
    - `handleListKnowledge` with `scope: undefined` → returns results (no regression).
    Add all new tests to the existing describe blocks for those handlers (or create
    a new describe block for the Group B list-scope tests if none exists).

11. **[Group A] Remove `@known-limitation` from `constraints.md`.**
    The Known Limitations section in
    `mcp-server/docs/agents/project-manifest/constraints.md` does not currently
    document the HTTP 500 vs 400 issue (the limitation was documented only in source
    code comments). No action required in `constraints.md` for this specific item.
    Verify this during implementation — if a KL entry exists, mark it Resolved.

12. **[Group D] Rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` across the MCP server.**
    The constant was named for the defunct `project` scope. It now validates both
    `repository_name` and `origin_plan` fields. No external consumers exist.
    Files to update (all within `mcp-server/`):
    - `src/schema/knowledge.ts` — rename the export declaration and all JSDoc references.
    - `src/storage/knowledge-store.ts` — rename the import and the single usage at
      `_validateSlug()` (line 517).
    - `src/tools/knowledge.ts` — rename the import and 5 Zod `.regex()` call sites.
    - `gui/api-knowledge.ts` — rename the import (line 46) and all 9 reference sites
      (Zod schemas + inline guard added in Steps 1–2 above + comments).
    - `tests/schema/knowledge.test.ts` — rename the import, the `describe` block label,
      and all assertion call sites.
    - `tests/gui/api-knowledge.test.ts` — rename the comment reference (line 921).
    - `src/tools/help-content.ts` — update the string literal at line 767
      (`"content": "Use PROJECT_SLUG_REGEX to..."`) to reference `SLUG_REGEX`.
    The `dist/` files are build output and must **not** be edited by hand — they will
    be regenerated by `npm run build` after the source changes.
    `mcp-server/docs/agents/project-manifest/api-surface.md` must also be updated to
    reflect the new export name.

13. **Update changelogs.**
    - Add an entry to `mcp-server/changelog.md` describing the handler hardening
      (Group A + B) and the low-priority cleanup items (Group C + D).

---

## Dependencies

- `PROJECT_SLUG_REGEX` from `src/schema/knowledge.ts` — already imported in
  `gui/api-knowledge.ts`.
- `validationError()` helper in `gui/api-knowledge.ts` — already defined and used.
- `InsightScope` from `src/schema/knowledge.ts` — already imported.
- No new dependencies or external packages required.

---

## Required Components

### Modified files

| File | Change |
|------|--------|
| `mcp-server/src/schema/knowledge.ts` | Rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` (declaration + JSDoc) |
| `mcp-server/src/storage/knowledge-store.ts` | Rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` (import + 1 usage) |
| `mcp-server/src/tools/knowledge.ts` | Rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` (import + 5 usages) |
| `mcp-server/gui/api-knowledge.ts` | Add slug guard in `handleDeleteKnowledge` + `handlePromoteKnowledge`; fix scope validation in `handleListKnowledge`; rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` (import + 9 sites); update JSDoc |
| `mcp-server/src/tools/help-content.ts` | Update string literal reference from `PROJECT_SLUG_REGEX` to `SLUG_REGEX` |
| `mcp-server/gui/public/api-client.js` | Replace `\|\| undefined` with `!= null` guard (4 sites) + update JSDoc |
| `mcp-server/tests/schema/knowledge.test.ts` | Rename `PROJECT_SLUG_REGEX` → `SLUG_REGEX` (import + describe label + assertion sites) |
| `mcp-server/tests/gui/api-knowledge.test.ts` | Add 7 new test cases (Group A + B); rename comment reference |
| `mcp-server/tests/tools/knowledge.test.ts` | Rename `projectInsightId` → `repositoryInsightId` (4 sites) |
| `mcp-server/docs/agents/project-manifest/api-surface.md` | Update export name from `PROJECT_SLUG_REGEX` to `SLUG_REGEX` |
| `mcp-server/changelog.md` | New entry |

### Verified-only (no change expected)

| File | Verification |
|------|-------------|
| `mcp-server/src/tools/help-content.ts` | Confirm `origin_plan` present in repository-scoped example |
| `mcp-server/docs/agents/project-manifest/constraints.md` | Confirm no KL entry for HTTP 500 vs 400 to remove |

---

## Assumptions

- `PROJECT_SLUG_REGEX` (imported from `src/schema/knowledge.ts`) is already available in
  `gui/api-knowledge.ts` with no additional import required.
- `validationError()` helper (module-private function in `gui/api-knowledge.ts`) is
  the correct throw point — consistent with all other VALIDATION_ERROR sites in that file.
- The `|| undefined` fix in `api-client.js` targets only the four `repositoryName`
  usages identified in the synthesis; no other `|| undefined` patterns in that file are
  in scope.
- The `origin_plan` item is already resolved (post-WP-004); the verification step
  confirms this with no expected code change.

---

## Constraints

- Do not add a Zod schema for query parameters in `handleDeleteKnowledge` or
  `handlePromoteKnowledge` — the inline guard is the prescribed approach for these
  function-parameter-based handlers.
- All changes must remain within the MCP server sub-project (`mcp-server/`). No changes
  to orchestrator, persona sources, or root scripts.
- No new npm dependencies.

---

## Out of Scope

- Automatic `repository_name` inference from `cwd_path` at the storage layer — noted in
  the synthesis as a future consideration, not a short-term item.
- Knowledge archival of the `origin_plan` provenance pattern to the global store — a
  runtime action for the Synthesis persona, not a code change.
- Any changes to the orchestrator or personas sub-projects.

---

## Acceptance Criteria

- **AC-1:** `handleDeleteKnowledge` called with `scope='repository'` and
  `repository_name='../evil'` throws `ApiError` with `code: 'VALIDATION_ERROR'` and
  does not throw a generic `Error` or return HTTP 500.
- **AC-2:** `handleDeleteKnowledge` called with `scope='repository'` and
  `repository_name='has spaces'` throws `ApiError` with `code: 'VALIDATION_ERROR'`.
- **AC-3:** `handlePromoteKnowledge` called with `scope='repository'` and
  `repository_name='../evil'` throws `ApiError` with `code: 'VALIDATION_ERROR'`.
- **AC-4:** `handlePromoteKnowledge` called with `scope='repository'` and
  `repository_name='has spaces'` throws `ApiError` with `code: 'VALIDATION_ERROR'`.
- **AC-5:** `handleListKnowledge` called with `params.scope: 'project'` throws
  `ApiError` with `code: 'VALIDATION_ERROR'`.
- **AC-6:** `handleListKnowledge` called with `params.scope: 'bogus'` throws
  `ApiError` with `code: 'VALIDATION_ERROR'`.
- **AC-7:** `handleListKnowledge` called with no `scope` param (or `scope: undefined`)
  returns all insights without error (no regression).
- **AC-8:** All existing tests in `tests/gui/api-knowledge.test.ts` and
  `tests/tools/knowledge.test.ts` continue to pass.
- **AC-9:** `repositoryInsightId` variable name is used in the `ledger_update_insight`
  describe block in `tests/tools/knowledge.test.ts` (no remaining `projectInsightId`
  references in that file).
- **AC-10:** The `|| undefined` pattern is absent from
  `gui/public/api-client.js` for all four `repositoryName` / `sourceRepositoryName`
  usages identified in the synthesis.
- **AC-11:** `PROJECT_SLUG_REGEX` is no longer exported from `src/schema/knowledge.ts`;
  `SLUG_REGEX` is exported in its place. All internal import sites use `SLUG_REGEX`.
  The TypeScript build (`npm run build`) succeeds with no errors.
- **AC-12:** All existing tests in `tests/schema/knowledge.test.ts` continue to pass
  after the rename (describe block label updated; import updated).

---

## Testing Strategy

All changes are covered by new and existing tests in `tests/gui/api-knowledge.test.ts`
and `tests/tools/knowledge.test.ts`. The handler tests use real temp directories and
`KnowledgeStoreManager` instances (the established pattern in this test suite). Seven new
test cases are added for the AC-1 through AC-7 acceptance criteria. All ~2731 existing
tests must continue to pass.

---

## Test Plan

- `tests/gui/api-knowledge.test.ts` — "handleDeleteKnowledge with malformed repository_name
  (path traversal) throws VALIDATION_ERROR" — covers AC-1
- `tests/gui/api-knowledge.test.ts` — "handleDeleteKnowledge with malformed repository_name
  (contains spaces) throws VALIDATION_ERROR" — covers AC-2
- `tests/gui/api-knowledge.test.ts` — "handlePromoteKnowledge with malformed repository_name
  (path traversal) throws VALIDATION_ERROR" — covers AC-3
- `tests/gui/api-knowledge.test.ts` — "handlePromoteKnowledge with malformed repository_name
  (contains spaces) throws VALIDATION_ERROR" — covers AC-4
- `tests/gui/api-knowledge.test.ts` — "handleListKnowledge with scope 'project' throws
  VALIDATION_ERROR" — covers AC-5
- `tests/gui/api-knowledge.test.ts` — "handleListKnowledge with scope 'bogus' throws
  VALIDATION_ERROR" — covers AC-6
- `tests/gui/api-knowledge.test.ts` — "handleListKnowledge with no scope param returns
  all insights (no regression)" — covers AC-7 (this test likely already exists; verify
  or add a complementary check if the no-params test does not assert `scope: undefined`
  explicitly)
- `tests/schema/knowledge.test.ts` — rename `describe('PROJECT_SLUG_REGEX', ...)` block
  label to `describe('SLUG_REGEX', ...)` and update the import — covers AC-11, AC-12

---

## Documentation Updates

- `mcp-server/gui/api-knowledge.ts` — Update file-level `@known-limitation` JSDoc
  comment block (lines 17–31) to remove the HTTP 500 / 400 inconsistency note and
  replace with confirmation of fix; update per-handler "Defence-in-depth note" JSDoc
  paragraphs in `handleDeleteKnowledge` and `handlePromoteKnowledge` to reflect that the
  issue is resolved; rename all `PROJECT_SLUG_REGEX` references to `SLUG_REGEX`.
- `mcp-server/gui/api-knowledge.ts` — Update `handleListKnowledge` JSDoc to replace
  "silently treated as no scope filter" with "throws VALIDATION_ERROR when scope is
  an unrecognised non-null value."
- `mcp-server/gui/public/api-client.js` — Update `@param` JSDoc lines that reference
  "falsy values are omitted" to say "null/undefined values are omitted."
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update the `InsightSchema`
  / schema exports section: replace `PROJECT_SLUG_REGEX` with `SLUG_REGEX` and update
  the description to note it validates both `repository_name` and `origin_plan` fields.
- `mcp-server/changelog.md` — Add new version entry summarising Group A, B, C, and D
  changes.

Per `AGENTS.md` Manifest Maintenance Rules, `file-tree.md` does not require an update —
no files were added or removed. The `api-surface.md` update above covers the exported
constant rename.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`handleListKnowledge` scope change breaks a caller that currently relies on silent fallback** | Any caller passing an explicit scope today passes `'global'` or `'repository'` — both are valid. The only invalid value rejected in practice is `'project'`, which was never a valid scope in the repository-scope model. The regression test (AC-7) confirms no-filter behaviour is preserved. |
| **`PROJECT_SLUG_REGEX.test(repository_name)` called with `repository_name` that is undefined** | In `handleDeleteKnowledge`, the guard is placed after the presence check (which throws if `scope === 'repository'` and `repository_name` is absent); in `handlePromoteKnowledge`, `repository_name` is asserted non-empty one line above. The test is safe. |
| **`!= null` change in `api-client.js` introduces a regression for existing callers** | All callers pass either a non-empty string (valid repo name) or `null`/`undefined`. The string `'0'` is not a valid `PROJECT_SLUG_REGEX` name, so no real repo produces it. The change is safe. |
| **Test suite disruption from variable rename** | The rename is localised to 4 sites within one `describe` block; no import or export changes. Low risk. |
