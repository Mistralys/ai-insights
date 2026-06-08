# Plan

## Plan Audit Cycles
- Audits: 2 — Plan Auditor v1.5.0
- Architectural Reviews: none — Plan Architect Reviewer v1.6.0

## Prior Project Context

This is a rework plan addressing actionable items from the [2026-06-04-planner-project-history-access synthesis](../2026-06-04-planner-project-history-access/synthesis.md). The original plan delivered `ledger_get_repository_context`, `outcome_summary` on the Synthesis agent, the repository registry, and the Strategy GUI. This rework addresses the high-value subset (schema hardening, coverage gaps, convention documentation) plus medium-priority strategic enhancements (filesystem discovery, insight deduplication).

## Summary

Harden the Planner history system delivered in the parent plan by: (1) adding a `min(10)` constraint to the `outcome_summary` input schema to prevent degenerate submissions; (2) closing the `writeProjectMeta` ↔ `outcome_summary` round-trip integration test gap; (3) deduplicating insights in `repository-context.ts` to prevent future token waste; (4) adding filesystem-discovery mode to the Strategy list API so undeclared namespaces are surfaced alongside declared repos; (5) documenting the dual-schema convention and graceful-degradation `@remarks` pattern as formal constraints.

## Architectural Context

- **`CompleteSynthesisSchema`** in `mcp-server/src/tools/project-lifecycle.ts` (line 692) declares `outcome_summary: z.string()` with no length guard.
- **`writeProjectMeta()`** in `mcp-server/src/storage/ledger-store.ts` (line 476) persists `outcome_summary` to `.meta.json` via `cacheUpdates` key-presence check.
- **Existing test file** `mcp-server/tests/storage/project-meta.test.ts` covers `writeProjectMeta` round-trips for other fields but not `outcome_summary`.
- **`getRepositoryContext()`** in `mcp-server/src/tools/repository-context.ts` concatenates `globalInsights` and `repoInsights` arrays without deduplication (line ~165).
- **`handleListRepos()`** in `mcp-server/gui/api-repos.ts` (line 188) returns only registry-declared repos. `LedgerStore.listAllProjects()` (line 678 in `ledger-store.ts`) returns `ProjectMeta[]` (individual projects, not namespace directories). Namespace discovery requires a direct `readdir` at the ledger root, filtering non-directories and dot-prefixed entries (the same logic `listAllProjects` uses internally at L688–L702).
- **`mcp-server/docs/agents/project-manifest/constraints.md`** — last constraint is #74.

## Approach / Architecture

Six independent changes, all backward-compatible:

1. **Schema hardening** — Add `.min(10)` to `outcome_summary` in `CompleteSynthesisSchema`. This is an input-only schema change; the storage schema remains `.nullable().optional()` (intentional dual-schema pattern).
2. **Integration test** — New test case in `mcp-server/tests/storage/project-meta.test.ts` that writes `outcome_summary` via `writeProjectMeta` and reads it back with `readProjectMeta`.
3. **Insight deduplication** — In `repository-context.ts`, deduplicate the merged `globalInsights + repoInsights` array by insight `id` before returning.
4. **Filesystem discovery API** — New optional `include_undeclared` boolean on `handleListRepos` (default `false`). When `true`, scan namespace directories at the ledger root and include entries not already covered by the registry. Return them with a `declared: false` flag in the list item.
5. **Strategy GUI integration** — Add a toggle in the Strategy list view (`strategy.js`) to enable/disable undeclared repo discovery, defaulting to off.
6. **Convention documentation** — Two new constraints in `constraints.md`: one for the dual-schema pattern (Gold Nugget 1) and one for the graceful-degradation `@remarks` contract (Gold Nugget 3).

## Rationale

- **`min(10)` guard:** An empty or trivially short `outcome_summary` provides no planning value and wastes Planner context window tokens. The Synthesis agent is instructed to write 2–3 sentences, so 10 characters is a permissive floor that only blocks degenerate input.
- **Integration test:** This is the only `.meta.json` enrichment field without a round-trip test. Closing the gap ensures regression safety for the critical `outcome_summary` persistence path.
- **Insight deduplication:** The knowledge store currently keeps global and repository scopes disjoint, but the schema does not prevent overlap. Deduplicating by `id` is O(n) and prevents future token waste without changing the API contract.
- **Filesystem discovery:** Users who haven't registered their repos in the Strategy GUI currently see an empty list. Surfacing undeclared namespaces with a clear visual distinction improves discoverability without requiring manual registration as a prerequisite.
- **Convention documentation:** Both patterns recurred across 3+ components in the parent plan. Documenting them prevents future contributors from "fixing" intentional design.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| `outcome_summary` validation | `.min(10)` on input schema only | `.min(1)`, regex guard, runtime check in handler | `.min(10)` balances preventing degenerate input vs. not being over-restrictive; input-only keeps storage schema permissive for legacy data |
| Insight deduplication | Deduplicate by `id` in response assembly | Upstream uniqueness constraint in knowledge store, no-op until overlap observed | Response-level dedup is zero-risk, non-breaking, and handles any future store overlap without requiring knowledge-store schema changes |
| Filesystem discovery | Optional `include_undeclared` query param on existing `GET /api/repos` | Separate endpoint, background scan job, CLI-only discovery | Reusing the existing endpoint keeps the API surface minimal; query param avoids breaking existing consumers |
| Undeclared repo shape in list | `RepoListItem` with `declared: false` + synthetic ID from folder name | Separate response type, nested array | Uniform list item shape simplifies frontend rendering and sorting |

## Pattern Alignment

- `min(10)` on input schema follows the existing pattern of strict input + permissive storage (see `RootIndexSchema` vs. `CompleteSynthesisSchema` for other fields).
- Integration test structure follows the established pattern in `mcp-server/tests/storage/project-meta.test.ts` (temp dir, `LedgerStore` instance, atomic round-trip).
- `handleListRepos` enhancement follows the established handler pattern in `mcp-server/gui/api-repos.ts` — single export, Zod-validated input, pure function over `ledgerRoot`.
- Query-parameter parsing in Step 8 follows the established `qIdx + URLSearchParams` pattern used 8+ times in `mcp-server/gui/server.ts` (e.g., `GET /api/projects` at L378–L391).
- Namespace discovery validation can leverage `listProjectsByFolderNames()` in `mcp-server/src/storage/ledger-store.ts` (L770) to confirm a discovered namespace contains actual projects before surfacing it.
- Constraint documentation follows the format defined in `constraints.md` header (Rule, Rationale, Anti-pattern, Correct pattern).

## Detailed Steps

### Step 1: Add `min(10)` to `CompleteSynthesisSchema.outcome_summary`

In `mcp-server/src/tools/project-lifecycle.ts` (line 713), change:
```typescript
outcome_summary: z.string().describe(...)
```
to:
```typescript
outcome_summary: z.string().min(10).describe(...)
```

### Step 2: Add integration test for `outcome_summary` round-trip

In `mcp-server/tests/storage/project-meta.test.ts`, add a test case:
- Call `store.writeProjectMeta('plan.md', 'COMPLETE', { outcome_summary: 'Project delivered X via Y with result Z.' })`
- Call `store.readProjectMeta()` and assert `result.outcome_summary === 'Project delivered X via Y with result Z.'`

### Step 3: Update existing `CompleteSynthesisSchema` tests

In the test file covering `completeSynthesis` (search for `CompleteSynthesisSchema` usage in tests), add a test that verifies the schema rejects strings shorter than 10 characters. Confirm existing tests use ≥10-char strings (adjust if needed).

### Step 4: Deduplicate insights in `repository-context.ts`

In `mcp-server/src/tools/repository-context.ts`, after the `Promise.all` that fetches `globalInsights` and `repoInsights` (~line 165), deduplicate:
```typescript
// Deduplicate by insight id (global takes precedence)
const seenIds = new Set<number>();
const deduped: Insight[] = [];
for (const insight of [...globalInsights, ...repoInsights]) {
  if (!seenIds.has(insight.id)) {
    seenIds.add(insight.id);
    deduped.push(insight);
  }
}
relevantInsights = deduped;
```

> **Note:** `InsightSchema.id` is `z.number().int()` — a numeric auto-incrementing integer, not a UUID string.

### Step 5: Add deduplication test

In `mcp-server/tests/tools/repository-context.test.ts`, add a test that sets up both global and repository insight JSON files containing an insight with the same `id`, calls `getRepositoryContext`, and asserts the response `relevant_insights` array contains only one entry for that `id`.

### Step 6: Extend `handleListRepos` with filesystem discovery

In `mcp-server/gui/api-repos.ts`:
- Add `include_undeclared?: boolean` parameter to `handleListRepos`.
- When `true`, perform a direct `fs.readdir(ledgerRoot, { withFileTypes: true })` to enumerate namespace directories, filtering out non-directories and dot-prefixed entries (same logic used internally by `LedgerStore.listAllProjects()` at L688–L702). Diff the resulting directory names against `registry.repositories[].folder_names` to find undeclared namespaces.
- Optionally validate each undeclared namespace contains actual projects via `LedgerStore.listProjectsByFolderNames()` before surfacing it.
- For each undeclared namespace, synthesize a `RepoListItem` with `id` = folder name, `label` = folder name, `folder_names` = [folder name], `has_vision` = false, `has_full_vision` = false, and a new `declared: boolean` field.
- Add `declared: true` to all registry-derived items.

### Step 7: Update `RepoListItem` type

Add `declared: boolean` to the `RepoListItem` interface in `api-repos.ts`. Update `toListItem()` to set `declared: true`.

### Step 8: Wire `include_undeclared` query parameter in server routing

In `mcp-server/gui/server.ts`, parse `?include_undeclared=true` from the `GET /api/repos` request URL using the established `qIdx + URLSearchParams` pattern (see `GET /api/projects` at L378–L391 for reference) and pass it to `handleListRepos`.

### Step 9: Add tests for filesystem discovery

In the `api-repos` test file, add tests:
- `handleListRepos(root, false)` returns only declared repos with `declared: true`.
- `handleListRepos(root, true)` returns declared repos + undeclared namespace entries with `declared: false`.
- Undeclared entries have correct synthetic shape.
- Namespaces already covered by a declared repo's `folder_names` are not duplicated.

### Step 10: Update Strategy GUI to toggle undeclared repos

In `mcp-server/gui/public/views/strategy.js`:
- Add a checkbox above the table: "Show undeclared repositories".
- When checked, re-fetch with `?include_undeclared=true`.
- Render undeclared repos with a muted style and a "Register" button that pre-fills the Add Repository form with the folder name.

### Step 11: Document dual-schema convention (Constraint 75)

Add to `mcp-server/docs/agents/project-manifest/constraints.md`:

```markdown
### 75. Dual-Schema Pattern — Strict Input Schemas, Permissive Storage Schemas

**Rule:** Input schemas (tool parameters) enforce strict contracts (required, non-nullable, min-length). Storage schemas (persisted JSON) declare the same fields as `.nullable().optional()` for backward compatibility with records created before the field existed. Bridge logic uses key-presence checks (`'field' in cacheUpdates`) to distinguish "not provided" from "explicitly null".

**Rationale:** Legacy records must parse without migration. New tool calls must enforce quality. The two concerns require different schema strictness levels — combining them into one schema satisfies neither.

**Canonical example:** `CompleteSynthesisSchema.outcome_summary` is `z.string().min(10)` (input); `ProjectMetaSchema.outcome_summary` is `z.string().nullable().optional()` (storage).

**Anti-pattern:** ❌ Using `.optional()` on an input schema to avoid handling legacy data — this shifts the quality gate to runtime callers.

**Correct pattern:** ✅ Input schema = strict; storage schema = permissive; bridge = key-presence check.
```

### Step 12: Document graceful-degradation convention (Constraint 76)

Add to `mcp-server/docs/agents/project-manifest/constraints.md`:

```markdown
### 76. Graceful Degradation — `@remarks` Fallback Contract for Optional Enrichment Paths

**Rule:** Any function that provides optional enrichment data (where absence is acceptable) must document its fallback behavior in a `@remarks` JSDoc block. The remark must state: (1) what conditions trigger the fallback, (2) what value is returned as the fallback, and (3) whether the fallback is silent or logged.

**Rationale:** Three components in the history system use this pattern (`loadRegistry`, `safeListRepositoryInsights`, Planner workflow step). Without explicit documentation, future contributors may "fix" the silent degradation by throwing errors, breaking the enrichment-is-optional contract.

**Canonical examples:** `loadRegistry()` in `repository-registry.ts` (returns `{ repositories: [] }` on absent/corrupt file), `safeListRepositoryInsights()` in `repository-context.ts` (returns `[]` on SLUG_REGEX failure).

**Anti-pattern:** ❌ A function that degrades gracefully but documents only the success path in JSDoc.

**Correct pattern:** ✅ `@remarks` block explicitly states fallback trigger, fallback value, and observability (silent/logged/metric).
```

## Dependencies

- Steps 1–3 are independent and can be parallelized.
- Step 4–5 are independent of steps 1–3 and can be parallelized.
- Steps 6–10 form a dependency chain (schema → handler → server routing → tests → GUI).
- Steps 11–12 are documentation-only and independent of all code changes.

## Required Components

- `mcp-server/src/tools/project-lifecycle.ts` — schema change (Step 1)
- `mcp-server/src/tools/repository-context.ts` — dedup logic (Step 4)
- `mcp-server/gui/api-repos.ts` — filesystem discovery handler (Steps 6–7)
- `mcp-server/gui/server.ts` — query param wiring (Step 8)
- `mcp-server/gui/public/views/strategy.js` — toggle UI (Step 10)
- `mcp-server/tests/storage/project-meta.test.ts` — new test (Step 2)
- `mcp-server/tests/tools/repository-context.test.ts` — new test (Step 5)
- `mcp-server/tests/gui/api-repos.test.ts` (or equivalent) — new tests (Step 9)
- `mcp-server/docs/agents/project-manifest/constraints.md` — new constraints 75–76 (Steps 11–12)

## Assumptions

- Direct `readdir` at the ledger root (filtering non-directories and dot-prefixed entries) reliably enumerates namespace directories for the discovery feature.
- Insight `id` fields are unique auto-incrementing integers (`z.number().int()`) as established by `KnowledgeStoreManager`.
- The current test suite passes (3,066 tests / 0 failures) as the baseline.
- No concurrent plan is modifying the same files.

## Constraints

- All changes must be backward-compatible — no breaking changes to existing API contracts.
- Storage schemas must NOT be made stricter (the dual-schema convention is an invariant).
- The `include_undeclared` parameter must default to `false` to preserve existing `GET /api/repos` behavior.
- The deduplication must preserve insertion order (global first, then repo-scoped unique additions).

## Out of Scope

- Legacy project backfill for `outcome_summary` (manual/script operation, not a code change).
- `help-content.ts` reorganization (D-8 — low priority housekeeping).
- Poll caching for `project-list.js` (D-9 — separate UX optimization).
- URL-encoded repoId test (O-2 — isolated low-risk gap).
- `ctx-architect.md` unresolved variables (O-4 — persona maintenance, not MCP server).
- Strategy nav link highlighting on sub-routes (O-3 — pure UX polish).

## Acceptance Criteria

- AC-1: `CompleteSynthesisSchema.parse({ ..., outcome_summary: 'short' })` throws a Zod validation error (string < 10 chars).
- AC-2: `CompleteSynthesisSchema.parse({ ..., outcome_summary: 'A valid summary of at least ten characters.' })` succeeds.
- AC-3: `writeProjectMeta` with `outcome_summary` in `cacheUpdates` persists the value; `readProjectMeta` returns it unchanged.
- AC-4: When `globalInsights` and `repoInsights` contain an insight with the same `id`, `ledger_get_repository_context` returns it only once.
- AC-5: `GET /api/repos` (no query param) returns only declared repos with `declared: true`.
- AC-6: `GET /api/repos?include_undeclared=true` returns declared + undeclared repos; undeclared entries have `declared: false` and correct synthetic shape.
- AC-7: Strategy GUI shows undeclared repos when toggle is enabled, with visual distinction and "Register" affordance.
- AC-8: Constraints 75 and 76 exist in `constraints.md` with Rule, Rationale, Anti-pattern, and Correct pattern sections.
- AC-9: All existing tests continue to pass (zero regressions).

## Testing Strategy

- **Unit tests:** Schema validation (min-length rejection/acceptance), insight deduplication logic, `handleListRepos` with/without discovery flag.
- **Integration tests:** `writeProjectMeta` round-trip for `outcome_summary`, `getRepositoryContext` with overlapping insights across stores, filesystem discovery against a temp ledger root with mixed declared/undeclared namespaces.
- **Manual verification:** Strategy GUI toggle renders undeclared repos correctly.

## Test Plan

- `mcp-server/tests/storage/project-meta.test.ts` — "writeProjectMeta persists outcome_summary and readProjectMeta returns it" — AC-3
- `mcp-server/tests/tools/project-lifecycle.test.ts` (or equivalent schema test) — "CompleteSynthesisSchema rejects outcome_summary shorter than 10 chars" — AC-1
- `mcp-server/tests/tools/project-lifecycle.test.ts` — "CompleteSynthesisSchema accepts outcome_summary ≥ 10 chars" — AC-2
- `mcp-server/tests/tools/repository-context.test.ts` — "deduplicates insights with same id across global and repo stores" — AC-4
- `mcp-server/tests/gui/api-repos.test.ts` — "handleListRepos without include_undeclared returns declared repos only" — AC-5
- `mcp-server/tests/gui/api-repos.test.ts` — "handleListRepos with include_undeclared surfaces undeclared namespaces" — AC-6
- `mcp-server/tests/gui/api-repos.test.ts` — "undeclared entries have declared: false and synthetic shape" — AC-6
- `mcp-server/tests/gui/api-repos.test.ts` — "declared folder_names are not duplicated in undeclared results" — AC-6

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/constraints.md` — Add constraints 75 and 76
- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `handleListRepos` signature (new param + `declared` field on `RepoListItem`)
- `mcp-server/docs/agents/project-manifest/file-tree.md` — No new files (all changes to existing files)
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Add a new flow entry documenting the repository-context response assembly (including the deduplication step), or add an inline source comment noting the dedup in `repository-context.ts` if a dedicated flow is deemed too heavyweight

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **`min(10)` breaks existing agent calls** | The Synthesis persona already generates 2–3 sentence summaries (~50–150 chars). 10 is a permissive floor. Add a clear Zod error message so any future failure is immediately diagnosable. |
| **Filesystem discovery is slow on large ledger roots** | Direct `readdir` at the ledger root is O(namespaces) — cheaper than `listAllProjects()` which recurses into projects. The `include_undeclared=false` default means no performance impact for normal usage. |
| **Adding `declared` to `RepoListItem` breaks frontend code** | The field is additive. Existing `strategy.js` code does not destructure or validate the list item shape — it accesses named properties. Adding `declared` is non-breaking. |
| **Insight deduplication changes response ordering** | Dedup preserves insertion order (global first). Existing consumers do not rely on a specific ordering contract. |
