# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: none — Plan Architect Reviewer v2.2.0

## Summary

This rework plan addresses all six deferred items from the `2026-08-04-knowledge-uuid-migration` synthesis. All items are test quality improvements, comment fixes, or test file maintenance — no production logic changes. The scope covers four files in `mcp-server/tests/`, one file in `scripts/`, and one comment fix in `mcp-server/src/storage/knowledge-store.ts`. CTX regeneration (deferred item #5) was completed prior to this plan and is excluded.

## Architectural Context

The knowledge UUID migration replaced numeric auto-increment IDs with UUID v4 strings across the MCP server's knowledge store. The migration is complete and all production code is correct. This rework addresses cleanup items identified during the code-review and documentation stages: weak test assertions that survived the migration, a missing schema-boundary test, confusingly named test files, and two inaccurate comments.

Key files:
- `mcp-server/src/schema/knowledge.ts` — `InsightSchema` uses `z.string().uuid()` for ID; `KnowledgeStoreSchema` uses Zod default `.strip()` mode
- `mcp-server/src/storage/knowledge-store.ts` — `KnowledgeStoreManager` with `moveInsight()` at L440+
- `mcp-server/tests/storage/knowledge-store.test.ts` — storage-layer tests
- `mcp-server/tests/schema/knowledge.test.ts` — schema-layer tests
- `mcp-server/tests/gui/api-knowledge.test.ts` — single-store handler tests (1276 lines)
- `mcp-server/tests/gui/knowledge-api.test.ts` — multi-store handler tests (780 lines)
- `scripts/migrate-knowledge-uuids.js` — one-time batch migration script

## Approach / Architecture

Five independent changes, all read-safe and test-only except for two single-line comment fixes:

1. **Tighten UUID assertions** — replace 4 bare `typeof id === 'string'` checks with UUID regex matches, using the inline regex pattern already established at L185 of the same file.
2. **Add `next_id` stripping test** — one new test case in the schema test file verifying that `KnowledgeStoreSchema.parse()` silently strips `next_id` from v1-shaped input.
3. **Rename multi-store test file** — rename `knowledge-api.test.ts` → `knowledge-api-multi-store.test.ts` to disambiguate from `api-knowledge.test.ts` and clarify the test boundary for multi-store scenarios.
4. **Add rationale comment** in the migration script explaining why dropping cross-file `superseded_by` references is safe.
5. **Fix `moveInsight()` comment** — correct the inaccurate claim that `movedAt` is "reused for both ... store.last_updated" (it's only used for the target store; the source store uses a fresh `now()`).

## Rationale

All items are low-risk maintenance improvements that reduce future confusion. Renaming the test file (rather than merging) avoids creating an unwieldy 2000+ line file and preserves the clear single-store vs. multi-store separation. The `next_id` stripping test documents an intentional schema behavior that was previously covered by four removed tests.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Test file consolidation strategy | Rename `knowledge-api.test.ts` to `knowledge-api-multi-store.test.ts` | Merge both files into one; create a shared test helper module | Renaming is the smallest change that eliminates the naming confusion; merging creates a 2000+ line file; a shared helper module is overkill for one duplicated function |
| UUID regex approach | Inline regex (matching existing pattern at L185) | Extract a shared `UUID_REGEX` constant to a test helper | No shared test helper module exists in the codebase for this purpose; introducing one for a single regex is over-engineered. The inline pattern is already established. |

## Pattern Alignment

- **Inline regex in tests** — follows the existing pattern at `knowledge-store.test.ts` L185–L186
- **Schema-layer test in `tests/schema/`** — follows the established convention of schema validation tests in `mcp-server/tests/schema/knowledge.test.ts`
- **Descriptive test file naming** — follows the existing pattern of scope-indicating names (e.g. `knowledge-repository-scope.test.ts`, `knowledge-multi-store.test.ts`)

## Detailed Steps

### Step 1: Tighten UUID assertions in `knowledge-store.test.ts`

In `mcp-server/tests/storage/knowledge-store.test.ts`, replace the four bare `typeof` checks with UUID regex assertions, matching the pattern already used at L183–L186:

- **L192**: Replace `expect(typeof first.id).toBe('string');` with `expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);`
- **L193**: Replace `expect(typeof second.id).toBe('string');` with `expect(second.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);`
- **L203**: Replace `expect(typeof insight2.id).toBe('string');` with `expect(insight2.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);`
- **L919**: Replace `expect(typeof targetAfter.insights[0].id).toBe('string');` with `expect(targetAfter.insights[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);`

### Step 2: Add schema-layer test for `next_id` stripping

In `mcp-server/tests/schema/knowledge.test.ts`, add a test case that:
1. Constructs a v1-shaped store object containing `next_id: 5` alongside valid v2 fields (`version: '2.0.0'`, `last_updated`, `insights: []`)
2. Parses it through `KnowledgeStoreSchema.parse()`
3. Asserts the result does NOT contain a `next_id` property (Zod `.strip()` discards it)
4. Asserts the parse succeeds without throwing (no `ZodError`)

### Step 3: Rename multi-store test file

Rename `mcp-server/tests/gui/knowledge-api.test.ts` → `mcp-server/tests/gui/knowledge-api-multi-store.test.ts`.

No content changes are needed — the file header already documents its WP-007 multi-store scope.

### Step 4: Add rationale comment in migration script

In `scripts/migrate-knowledge-uuids.js`, add a comment block before the `superseded_by` mapping logic (around L140) explaining:
- Each knowledge store file is a self-contained scope unit with its own independent ID namespace
- Cross-file `superseded_by` references are structurally invalid (v1 used per-file auto-increment counters, so ID `3` in `global-insights.json` and ID `3` in `repo-insights.json` are different insights)
- Dropping unmapped references is therefore safe and correct

### Step 5: Fix `moveInsight()` comment

In `mcp-server/src/storage/knowledge-store.ts` at L445, change:
```
const movedAt = now(); // capture once — reused for both movedInsight.updated_at and store.last_updated
```
to:
```
const movedAt = now(); // capture once — used for movedInsight.updated_at and targetStore.last_updated
```

This accurately reflects that `movedAt` is used for the moved insight and the target store, while the source store (step 6, L467) uses a fresh `now()` call.

### Step 6: Update `file-tree.md` for the renamed test file

In `mcp-server/docs/agents/project-manifest/file-tree.md`, apply three updates to reflect the Step 3 rename:

1. **L194**: Rename the `knowledge-api.test.ts` entry to `knowledge-api-multi-store.test.ts` (update the filename in both the tree node and the annotation text).
2. **L189** (`api-knowledge.test.ts` annotation): Update the cross-reference from `knowledge-api.test.ts` to `knowledge-api-multi-store.test.ts`.
3. **L195** (`knowledge-repository-scope.test.ts` annotation): Update the phrase "follows knowledge-api.test.ts patterns" to "follows knowledge-api-multi-store.test.ts patterns".

Use grep to locate the exact lines before editing — they may have shifted from the numbers stated above.

## Dependencies

- None. All steps are independent and can be executed in any order.

## Required Components

- `mcp-server/tests/storage/knowledge-store.test.ts` (modification)
- `mcp-server/tests/schema/knowledge.test.ts` (modification — new test case)
- `mcp-server/tests/gui/knowledge-api.test.ts` → `knowledge-api-multi-store.test.ts` (rename)
- `scripts/migrate-knowledge-uuids.js` (modification — comment)
- `mcp-server/src/storage/knowledge-store.ts` (modification — comment)
- `mcp-server/docs/agents/project-manifest/file-tree.md` (modification — update filename references)

## Assumptions

- The line numbers referenced in this plan correspond to the current file state (post-UUID-migration, pre-rework).
- No production logic changes are needed — all code is functionally correct.

## Constraints

- No new dependencies.
- No production behavior changes.
- All existing tests must continue to pass unchanged (except the 4 tightened assertions, which are strictly more specific).

## Out of Scope

- Extending the UUID pattern to other schema counters (strategic recommendation #4 from synthesis — no immediate consumer)
- Version bump / release engineering (separate workflow concern)
- The `ledger_get_repository_context` failure caused by numeric IDs in a knowledge store (separate data issue, not a code defect)

## Acceptance Criteria

- AC-01: All 4 bare `typeof id === 'string'` assertions in `knowledge-store.test.ts` are replaced with UUID regex matches
- AC-02: A new test in `tests/schema/knowledge.test.ts` verifies that `KnowledgeStoreSchema.parse()` silently strips `next_id` without throwing
- AC-03: `tests/gui/knowledge-api.test.ts` is renamed to `tests/gui/knowledge-api-multi-store.test.ts`
- AC-04: `scripts/migrate-knowledge-uuids.js` contains a rationale comment explaining why cross-file `superseded_by` references are dropped
- AC-05: The `moveInsight()` comment in `knowledge-store.ts` accurately describes which stores use `movedAt`
- AC-06: Full test suite passes (`npm test` in `mcp-server/`)
- AC-07: `mcp-server/docs/agents/project-manifest/file-tree.md` references `knowledge-api-multi-store.test.ts` (not the old name) in all three annotation sites

## Testing Strategy

All changes are either test improvements or comments. The test suite itself is the verification mechanism. Run the full `mcp-server` test suite to confirm no regressions.

## Test Plan

- `mcp-server/tests/storage/knowledge-store.test.ts` — existing tests at L183–L203 and L919 now assert UUID format instead of bare string type — covers AC-01
- `mcp-server/tests/schema/knowledge.test.ts` — new test "KnowledgeStoreSchema strips unknown fields (next_id)" — covers AC-02
- Full test suite run (`npm test` in `mcp-server/`) — covers AC-06

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/file-tree.md` — update three annotation sites that reference the renamed test file (covered by Step 6). Required by the mcp-server `AGENTS.md` manifest maintenance rule: "Rename/move file → `file-tree.md`".

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Line numbers may have shifted** since the synthesis was written | Verify exact line positions before editing; use grep to locate the patterns rather than relying on hardcoded line numbers |
| **Test file rename breaks imports** | `knowledge-api.test.ts` is a leaf test file — no other file imports from it. Rename is safe. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** All changes are single-module test quality fixes within well-understood patterns; no cross-cutting concerns, no new architecture, and self-review is adequate.
