
# Plan

## Plan Audit Cycles
- Audits: 1 — Plan Auditor v1.7.0
- Architectural Reviews: 1 — Plan Architect Reviewer v2.2.0

## Prior Project Context
The multi-store architecture was completed across several projects (2026-08-02 through 2026-08-04), culminating in `gui-knowledge-multi-store` which made all GUI route handlers multi-store aware. That project's synthesis identified a `[low] (debt)` item: the `listKnowledge` and `searchKnowledge` dedup uses `insight.id` (numeric) as the key, and because each store assigns IDs starting from 1 independently, two stores can produce insights with the same numeric ID. First-store-wins dedup silently drops the second. This plan addresses that finding.

## Summary
Replace the per-store auto-increment numeric `id` on knowledge insights with a UUID v4 string identifier, eliminating cross-store ID collisions, enabling stable IDs across moves/copies, and fixing the `superseded_by` cross-reference fragility. All known stores are available in the workspace (`ledger-storage/`, `nexus-ledger-storage/`), so the migration is a one-time batch script with no backward-compatibility layer needed. The schema version bumps from `"1.0.0"` to `"2.0.0"` and the `next_id` counter is removed entirely.

## Architectural Context

The knowledge store is a flat-file JSON system under `{ledgerRoot}/.knowledge/` with one file per scope (`global-insights.json`, `{repo}-insights.json`). Each file conforms to `KnowledgeStoreSchema` and contains a `next_id` auto-increment counter plus an `insights[]` array. The `KnowledgeStoreManager` class provides all CRUD operations; `MultiStoreManager` aggregates across stores.

Key existing patterns:
- `id: z.number().int()` on `InsightSchema` — per-store counter starting at 1
- `next_id` on `KnowledgeStoreSchema` — auto-increment, mutated in-place by `nextId()`
- `superseded_by: z.number().int().optional()` — cross-references another insight by numeric ID
- `formatInsightId()` in `src/tools/knowledge.ts` — produces `KN-NNNN` display format, with optional `{storeId}:` prefix in multi-store mode
- `parseKnowledgeId()` in `gui/api-knowledge.ts` — validates HTTP `:id` param as positive integer
- `moveInsight()` assigns a NEW ID from target store's counter — original ID becomes invalid

The model-registry subsystem (`gui/api-models.ts`, `gui/model-registry.ts`) already uses UUID v4 for model IDs with `z.string().uuid()` and `import { randomUUID } from 'crypto'`, establishing the codebase precedent.

Current data surface (10 files, 2 stores):
- `ledger-storage/store/.knowledge/`: 7 files (`global-insights.json` at next_id 97, plus 6 repository-scoped files)
- `nexus-ledger-storage/store/.knowledge/`: 3 repository-scoped files
- No existing `superseded_by` references in any file (verified via grep)

## Approach / Architecture

1. **One-time batch migration script** (`scripts/migrate-knowledge-uuids.js`): Scans all configured stores, assigns UUIDs to every insight, maps `superseded_by` references (none exist currently, but handled for correctness), removes `next_id`, bumps version to `"2.0.0"`, writes back atomically. Run once before deploying the code changes. No lazy migration, no backward-compat parsing — the stores are upgraded upfront.
2. **Schema change:** Replace `id: z.number().int()` with `id: z.string().uuid()` on `InsightSchema`. Replace `superseded_by: z.number().int()` with `z.string().uuid()`. Remove `next_id` from `KnowledgeStoreSchema` entirely (no optional fallback needed).
3. **Storage layer:** Replace `nextId()` with `crypto.randomUUID()`. Update `addInsight()` to assign a UUID. Update `moveInsight()` to **preserve the original UUID** — a major simplification. Remove all `next_id` mutation logic.
4. **Multi-store dedup:** Change `Set<number>` to `Set<string>` in `MultiStoreManager`, in the `searchInsights()` and `listInsights()` multi-store blocks in `knowledge.ts`, and in the dedup block in `repository-context.ts`. Remove the now-dead `storeMap`/`storeIdByInsightId` Map variables from `knowledge.ts` (they were only used as input to `formatInsightId`). UUID uniqueness makes cross-store collisions statistically impossible, but the dedup sets are retained as a safety net.
5. **MCP tools:** Change `id` input parameters from `z.number().int()` to `z.string().uuid()`. Remove `formatInsightId()` entirely — UUID is the canonical ID. Update `superseded_by` parameter type.
6. **GUI:** Update `parseKnowledgeId()` to validate UUID format. Update frontend `knowledge.js` to display UUID-based IDs. Update `KnowledgeUpdateBodySchema.superseded_by` type.
7. **Tests:** Update all 6 knowledge test files to use UUID assertions. Update `repository-context.test.ts` (raw JSON fixtures) and `repository-context-multi-store.test.ts` (dedup test rewrite).
8. **Documentation:** Update `api-surface.md`, `constraints.md`, `data-flows.md`, `file-tree.md`, `help-content.ts`.

## Rationale

- **UUIDs are collision-free by design.** This eliminates the fundamental multi-store dedup problem without adding composite-key complexity.
- **Stable IDs across moves** simplify `moveInsight()` and make `superseded_by` cross-references reliable regardless of which store an insight resides in.
- **`crypto.randomUUID()`** is a Node.js built-in (stable since v19) — no new dependency required.
- **Precedent:** The model-registry already uses UUID v4 with `z.string().uuid()` in this codebase.
- **Batch migration over lazy migration:** All stores are available in the workspace. A one-time script is simpler, deterministic, and eliminates the need for a backward-compat schema layer or version-gating in `_readStore()`.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| ID format | UUID v4 string | Composite key (`storeId:numericId`), ULID, nanoid | Composite key couples IDs to store identity (breaks when stores are renamed); ULID/nanoid add dependencies. UUID v4 is built-in, collision-free, and already used in the model-registry. |
| Migration strategy | One-time batch script | Lazy in-memory migration on read, eager migration at startup | All stores are available in the workspace — a one-time script is simpler and avoids runtime migration complexity. Lazy migration would add permanent version-gating code to `_readStore()` that is never needed after the initial run. |
| `moveInsight()` ID behavior | Preserve original UUID | Assign new UUID on move | Preserving the ID is the whole point — UUIDs are globally unique, so there's no need to reassign. This simplifies the code and keeps `superseded_by` references valid. |
| Display format | Full UUID | Shortened UUID prefix (first 8 chars), keep `KN-NNNN` | Full UUID is unambiguous and what agents/APIs will use. Short prefixes risk ambiguity. `KN-NNNN` was a display-layer artifact that loses purpose with UUIDs. |
| `superseded_by` type | `z.string().uuid()` | Keep as `z.number().int()` (legacy) | Must match the `id` type — otherwise cross-references between numeric and UUID systems would be incoherent. |

## Pattern Alignment

- **UUID generation via `crypto.randomUUID()`** — follows the model-registry precedent in `mcp-server/gui/api-models.ts` L46, L178.
- **`z.string().uuid()` schema validation** — follows the `ModelSchema` pattern in `mcp-server/src/gui/model-registry.ts` L35.
- **Atomic writes under lock** — existing `withLock()` + `atomicWriteJson()` pattern preserved for all CRUD operations.
- **Root-level migration script** — follows the existing pattern of workspace-root scripts in `scripts/` (e.g., `scripts/import-standalone.js`). Uses Node.js built-in `fs`, `path`, `crypto` — no Unix shell deps (cross-platform policy).

## Detailed Steps

### Step 1: Create batch migration script

Create `scripts/migrate-knowledge-uuids.js` at workspace root:
- Read the stores config from `~/.ai-insights/stores.json` (or fall back to the `LEDGER_ROOT` env var for single-store mode).
- For each store path, scan `{storePath}/.knowledge/` for all `*-insights.json` and `global-insights.json` files.
- For each file:
  1. Parse JSON content.
  2. Skip if `version` is already `"2.0.0"`.
  3. Build `Map<number, string>` mapping each insight's numeric `id` to a new UUID v4.
  4. Update each insight's `id` to its UUID.
  5. Update each insight's `superseded_by` using the map (if present and the referenced ID exists in the map; drop if not found — matches current broken-reference behavior).
  6. Remove `next_id` field.
  7. Set `version` to `"2.0.0"` and `last_updated` to current ISO timestamp.
  8. Write back atomically (write to `.tmp` then rename).
- Support `--dry-run` flag (report what would be changed without writing).
- Support `--verbose` flag (log each file and the ID mappings).
- Cross-platform: use `path.join()`, `fs/promises`, no shell deps.

### Step 2: Update `InsightSchema` and `KnowledgeStoreSchema`

In `mcp-server/src/schema/knowledge.ts`:
- Change `id: z.number().int()` to `id: z.string().uuid()`.
- Change `superseded_by: z.number().int().optional()` to `z.string().uuid().optional()`.
- Remove `next_id: z.number().int().nonnegative()` from `KnowledgeStoreSchema` entirely.
- Update JSDoc comments: `id` is now a UUID v4 string; `superseded_by` references a UUID.

### Step 3: Update `KnowledgeStoreManager` CRUD methods

In `mcp-server/src/storage/knowledge-store.ts`:
- Import `randomUUID` from `crypto`.
- Remove `nextId()` method entirely.
- In `addInsight()`: replace `const numericId = store.next_id; this.nextId(store);` with `const id = randomUUID();`. Remove the `next_id` mutation. Use `id` directly in the `InsightSchema.parse()` call.
- In `moveInsight()`: **preserve the original insight's `id`** instead of assigning a new one. Remove the `newNumericId = targetStore.next_id; targetStore.next_id = newNumericId + 1;` block. The moved insight keeps its UUID, gets updated `scope`, `repository_name`, and `updated_at`. The comment about "new id (from the target store's next_id counter)" is removed.
- In `_emptyStore()`: remove `next_id: 1` from the returned object. Set `version: '2.0.0'`.
- Verify `updateInsight()` and `deleteInsight()` — these use `findIndex((i) => i.id === id)` which works with string `===` comparison unchanged.

### Step 4: Update all multi-store dedup structures

In `mcp-server/src/storage/multi-store-manager.ts`:
- Change `const seen = new Set<number>()` to `const seen = new Set<string>()` in both `searchKnowledge()` and `listKnowledge()`.
- Update JSDoc: dedup is now by UUID string. Note that UUID collisions are statistically impossible, making the dedup a safety net rather than a functional necessity.

In `mcp-server/src/tools/repository-context.ts`:
- Change `const seenIds = new Set<number>()` to `const seenIds = new Set<string>()` in the insight dedup block.
- Update the inline comment: "Deduplicate by insight id (global insights take precedence over repo-scoped)" — no further change needed; the logic and comment remain accurate.

### Step 5: Update MCP tool schemas and handlers

In `mcp-server/src/tools/knowledge.ts`:
- Remove `formatInsightId()` entirely. Replace all call sites with direct use of `insight.id` (the UUID itself). Remove all `formatted_id` properties from response objects — the `id` field is now the canonical human-readable identifier.
- In `searchInsights()` and `listInsights()` multi-store blocks: change `const seen = new Set<number>()` to `const seen = new Set<string>()`. Remove the `const storeMap = new Map<number, string>()` and `storeIdByInsightId` variable declarations and all their usages — these exist solely to feed `formatInsightId`, which is removed. The `seen` Set is still required for dedup.
- Remove the dead `insightStoreId` variable in `updateInsight()` and the dead `deletedStoreId` variable in `deleteInsight()` — both are only used to pass a store prefix to `formatInsightId`.
- Update `UpdateInsightSchema.id` from `z.number().int()` to `z.string().uuid()`.
- Update `UpdateInsightSchema.superseded_by` from `z.number().int()` to `z.string().uuid()`.
- Update `DeleteInsightSchema.id` from `z.number().int()` to `z.string().uuid()`.
- Update `.describe()` strings: "Numeric ID" → "UUID".
- In response JSON objects: remove `formatted_id` spread — the `id` field is the UUID.

### Step 6: Update MCP tool help content

In `mcp-server/src/tools/help-content.ts`:
- Update the tool summary table entries for `ledger_update_insight` and `ledger_delete_insight`: "numeric ID" → "UUID".
- Update the detailed help sections for each knowledge tool.
- Remove the "KN-NNNN display format" example insight (line ~805).
- Remove or rewrite the "Numeric IDs are per-store counters" tips to state that UUIDs are globally unique and stable across stores and moves.
- Update `superseded_by` description: "Numeric ID" → "UUID".
- Update `id` parameter descriptions: "Numeric insight ID" → "UUID of the insight".

### Step 7: Update GUI API handlers

In `mcp-server/gui/api-knowledge.ts`:
- Replace `parseKnowledgeId()` implementation: validate that the raw string matches UUID format (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`). Return the string directly. Update the return type from `number` to `string`. Remove the decimal-point check and integer coercion logic.
- Update `KnowledgeUpdateBodySchema.superseded_by` from `z.number().int().nullable().optional()` to `z.string().uuid().nullable().optional()`.
- All handlers that call `parseKnowledgeId()` work transparently since they pass the result to `KnowledgeStoreManager` methods which now accept string IDs.

### Step 8: Update GUI frontend

In `mcp-server/gui/public/views/knowledge.js`:
- The `var id = ins.id` usage works unchanged with string UUIDs (valid HTML `id` attribute values).
- Update `superseded_by` display: change `'Superseded by KN-' + ins.superseded_by` to `'Superseded by ' + ins.superseded_by`.
- Verify: edit form ID extraction (`input.id.replace('kn-edit-conf-', '')`) works with UUID strings.
- Verify: `allInsights.filter(function (ins) { return ins.id !== id; })` works with string `!==`.

### Step 9: Update tests

Across all 6 knowledge test files:
- Replace numeric ID assertions (`expect(insight.id).toBe(1)`) with UUID format assertions (e.g., `expect(insight.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)`).
- Update `superseded_by` test values from numbers to valid UUID strings.
- Update test helpers that create insights to expect string IDs.
- Update `moveInsight()` tests to assert the ID is **preserved** (same UUID before and after move), not changed.
- Update `parseKnowledgeId()` tests to validate UUID input and rejection of non-UUID strings.
- Remove any `nextId()` tests.
- In multi-store tests: verify dedup with `Set<string>`. Test with a manually duplicated UUID to exercise the dedup path.

In `mcp-server/tests/tools/repository-context.test.ts`:
- Update the `seedKnowledgeStore()` helper to write v2 JSON: change `version: '1.0.0'` to `version: '2.0.0'`, remove the `next_id` field computation and property, and change all hardcoded numeric `id` values (e.g. `id: 42`, `id: 1`, `id: 2`) to UUID strings. The `maxId` computation is no longer needed.

In `mcp-server/tests/tools/repository-context-multi-store.test.ts`:
- Rewrite the AC-2 dedup test: the current test relies on two stores both being assigned `id: 1` from their independent auto-increment counters. With UUIDs, `addInsight()` generates distinct UUIDs in every store — the collision never occurs and dedup is never exercised. Replace the approach: directly write a known UUID into both stores' raw JSON files before the test, then verify that only one insight with that UUID appears in the merged result. This correctly exercises the `Set<string>` dedup path.

### Step 10: Run migration and verify

- Run `node scripts/migrate-knowledge-uuids.js --dry-run` first to preview changes.
- Run `node scripts/migrate-knowledge-uuids.js` to migrate all 10 knowledge store files across both stores.
- Verify: each file has `"version": "2.0.0"`, no `next_id` field, all insights have UUID `id` values, no `superseded_by` references were lost.
- Run the full MCP server test suite to confirm no regressions.

### Step 11: Update manifest documentation

- `mcp-server/docs/agents/project-manifest/api-surface.md`:
  - Update `InsightSchema` documentation to show `id: z.string().uuid()`.
  - Update `KnowledgeStoreSchema` to remove `next_id`.
  - Update `superseded_by` type documentation.
  - Remove `formatInsightId()` documentation.
  - Update `parseKnowledgeId()` return type and validation description.
  - Update tool schema tables for `ledger_update_insight`, `ledger_delete_insight`.
  - Update `moveInsight()` documentation to note that IDs are now preserved across moves.
  - Remove all `formatted_id` references from response object documentation.

- `mcp-server/docs/agents/project-manifest/constraints.md`:
  - Document that knowledge store IDs are UUID v4 strings, globally unique across stores.
  - Document that `next_id` no longer exists — ID generation uses `crypto.randomUUID()`.
  - Update existing knowledge-store-related constraints that reference numeric IDs.

- `mcp-server/docs/agents/project-manifest/data-flows.md`:
  - Update knowledge store data flow diagrams to remove `next_id` counter logic.
  - Update `moveInsight()` flow to show ID preservation.
  - Update `addInsight()` flow to show UUID generation.

- `mcp-server/docs/agents/project-manifest/file-tree.md`:
  - Update the `knowledge.ts` annotation: remove the `formatInsightId(id, storeId?) helper (KN-NNNN ...)` clause.
  - Update the `knowledge.ts` annotation and the `cross-device-portability.test.ts` annotation: replace "numeric insight id" / "numeric id" with "UUID".

### Step 12: Update root-level AGENTS.md cross-system dependencies

In root `AGENTS.md`:
- The Knowledge Collection cross-system dependency table entry references `.knowledge/` store layout. Update if the format description mentions `next_id` or `KN-NNNN`.

## Dependencies

- Step 1 (migration script) is independent — can be developed in parallel with code changes.
- Step 2 (schema) must be completed before Steps 3–8 (code consumers).
- Steps 3–8 are independent of each other and can be done in parallel after Step 2. Step 4 covers three files (`multi-store-manager.ts`, `repository-context.ts`, `knowledge.ts` dedup).
- Step 9 (tests) depends on Steps 2–8.
- Step 10 (run migration) depends on Steps 1 and 9 (script exists and tests pass).
- Steps 11–12 (docs) are independent of code changes.

## Required Components

- `scripts/migrate-knowledge-uuids.js` — new migration script
- `mcp-server/src/schema/knowledge.ts` — schema modification
- `mcp-server/src/storage/knowledge-store.ts` — storage layer modification
- `mcp-server/src/storage/multi-store-manager.ts` — dedup modification
- `mcp-server/src/tools/knowledge.ts` — MCP tool modification (schemas, formatInsightId removal, dedup Set/Map cleanup)
- `mcp-server/src/tools/repository-context.ts` — dedup modification (Set<number> → Set<string>)
- `mcp-server/src/tools/help-content.ts` — help text modification
- `mcp-server/gui/api-knowledge.ts` — GUI API modification
- `mcp-server/gui/public/views/knowledge.js` — GUI frontend modification
- `mcp-server/tests/schema/knowledge.test.ts` — test modification
- `mcp-server/tests/storage/knowledge-store.test.ts` — test modification
- `mcp-server/tests/tools/knowledge.test.ts` — test modification
- `mcp-server/tests/tools/knowledge-multi-store.test.ts` — test modification
- `mcp-server/tests/gui/knowledge-api.test.ts` — test modification
- `mcp-server/tests/gui/knowledge-repository-scope.test.ts` — test modification
- `mcp-server/tests/tools/repository-context.test.ts` — test modification (v2 JSON fixtures, remove next_id)
- `mcp-server/tests/tools/repository-context-multi-store.test.ts` — test modification (rewrite dedup test for UUID)
- `mcp-server/docs/agents/project-manifest/api-surface.md` — doc modification
- `mcp-server/docs/agents/project-manifest/constraints.md` — doc modification
- `mcp-server/docs/agents/project-manifest/data-flows.md` — doc modification
- `mcp-server/docs/agents/project-manifest/file-tree.md` — doc modification (remove formatInsightId annotation, update numeric-id references)
- `ledger-storage/store/.knowledge/*.json` — data migration (7 files)
- `nexus-ledger-storage/store/.knowledge/*.json` — data migration (3 files)

## Assumptions

- Node.js runtime supports `crypto.randomUUID()` (stable since v19; the project targets Node.js with ES2022 — verified).
- All knowledge stores are accessible in the workspace and can be migrated before deploying code changes.
- No external systems depend on the numeric ID values or `KN-NNNN` display format.
- No existing `superseded_by` cross-references exist in any store file (verified via grep).

## Constraints

- **No backward compatibility needed:** All stores are migrated upfront. The schema and code can assume v2 format exclusively.
- **Cross-platform:** `crypto.randomUUID()` is available on all supported platforms (Windows, macOS, Linux). Migration script uses Node.js built-ins only.
- **Atomic writes:** Migration script writes to a temp file then renames, preventing partial writes.
- **No new dependencies:** `crypto.randomUUID()` is a Node.js built-in.

## Out of Scope

- Cross-store `superseded_by` references (a global insight referencing a repository insight) — the current system doesn't support this and it remains unchanged.
- Referential integrity enforcement for `superseded_by` — remains unenforced at the schema layer (consistent with current behavior).
- GUI frontend visual redesign — the knowledge view will display UUIDs where it previously showed `KN-NNNN`; no new UI components are introduced.
- Orchestrator changes — the orchestrator does not directly consume insight IDs.
- Persona instruction updates — persona content references knowledge tools by behavior, not by ID format; the MCP tool schema changes are self-documenting.

## Acceptance Criteria

- AC-01: `InsightSchema.id` is `z.string().uuid()` and all CRUD operations assign UUID v4 strings.
- AC-02: `KnowledgeStoreSchema` no longer has a `next_id` field. New stores are created at version `"2.0.0"`.
- AC-03: A migration script (`scripts/migrate-knowledge-uuids.js`) converts all existing knowledge store files from v1 (numeric IDs, `next_id`) to v2 (UUID IDs, no `next_id`). Supports `--dry-run`.
- AC-04: `moveInsight()` preserves the insight's original UUID across moves (no new ID assignment).
- AC-05: `superseded_by` field accepts `z.string().uuid()` (or `.nullable()` in GUI body schema) instead of `z.number().int()`.
- AC-06: `MultiStoreManager.searchKnowledge()` and `listKnowledge()` use `Set<string>` for dedup with no cross-store collision risk.
- AC-07: MCP tool input schemas for `ledger_update_insight` and `ledger_delete_insight` accept UUID string `id` parameter. `formatted_id` is removed from response objects.
- AC-08: GUI `parseKnowledgeId()` validates UUID format and returns a string.
- AC-09: GUI knowledge view displays UUID-based IDs and `superseded_by` references correctly.
- AC-10: All existing knowledge test suites pass with updated assertions.
- AC-11: All 10 knowledge store files across both workspace stores are migrated to v2 format.
- AC-12: `api-surface.md`, `constraints.md`, and `data-flows.md` are updated to document the UUID-based ID system.

## Testing Strategy

Testing proceeds in layers: schema validation tests first, then storage-layer unit tests, then MCP tool integration tests, then GUI API tests. Each layer verifies that the UUID-based ID system works correctly at its boundary.

The migration script is tested by running it with `--dry-run` against the real store data, then running it for real, then executing the full test suite against the migrated data.

## Test Plan

- `tests/schema/knowledge.test.ts` — Update all `InsightSchema` tests to use UUID strings for `id` and `superseded_by`. Add test: rejects non-UUID string for `id`. Add test: accepts valid UUID for `superseded_by`. — AC-01, AC-05
- `tests/storage/knowledge-store.test.ts` — Update `addInsight` tests to assert UUID format on returned `id`. Update `moveInsight` tests to assert ID preservation (same UUID before/after). Remove `nextId` tests. — AC-01, AC-02, AC-04
- `tests/tools/knowledge.test.ts` — Update tool call assertions from numeric to UUID ID format. Update `superseded_by` tool parameter tests. Remove `formatted_id` assertions. — AC-07
- `tests/tools/knowledge-multi-store.test.ts` — Update multi-store dedup assertions to use UUID. Verify no silent drops with distinct UUIDs. — AC-06, AC-07
- `tests/gui/knowledge-api.test.ts` — Update `parseKnowledgeId` tests: valid UUID accepted, non-UUID strings rejected. Update `superseded_by` body parameter tests. — AC-08, AC-09
- `tests/gui/knowledge-repository-scope.test.ts` — Update ID assertions from numeric to UUID format. — AC-08

## Documentation Updates

- `mcp-server/docs/agents/project-manifest/api-surface.md` — Update `InsightSchema` type doc, `KnowledgeStoreSchema` type doc (remove `next_id`), remove `formatInsightId()`, update `parseKnowledgeId()` signature and return type, update `moveInsight()` behavior doc, update tool schemas, remove `formatted_id` from response docs, update GUI handler schemas.
- `mcp-server/docs/agents/project-manifest/constraints.md` — Document UUID-based insight IDs, removal of `next_id`, and the migration approach. Update existing references to numeric insight IDs.
- `mcp-server/docs/agents/project-manifest/data-flows.md` — Update knowledge store data flow: remove `next_id` counter logic, update `moveInsight()` flow (ID preservation), update `addInsight()` flow (UUID generation).
- `mcp-server/docs/agents/project-manifest/file-tree.md` — Remove the `formatInsightId(id, storeId?) helper (KN-NNNN ...)` clause from the `knowledge.ts` annotation; replace "numeric insight id" / "numeric id" with "UUID" in the `knowledge.ts` and `cross-device-portability.test.ts` annotations.
- `mcp-server/src/tools/help-content.ts` — Update all knowledge tool documentation strings (inline docs served by `ledger_help`).

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Migration corrupts existing knowledge data** | The migration script writes to a temp file then renames (atomic). If the process crashes mid-migration, the original file is preserved. Run `--dry-run` first. Both stores should be committed to Git before running. |
| **Agent tool consumers send numeric IDs after upgrade** | `z.string().uuid()` validation on input schemas rejects non-UUID inputs with a clear Zod validation error. Agents see updated tool descriptions on next tool load. |
| **GUI URL routes with UUID `:id` segments** | UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) is URL-safe and doesn't conflict with Express route parsing. No encoding needed. |
| **Tests fail due to UUID non-determinism** | Tests assert UUID *format* (regex match) rather than specific values. For tests that need to track a specific insight, capture the returned `id` and use it for subsequent operations. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module change within the MCP server following well-understood patterns (UUID generation, schema updates, test updates). The migration script is a straightforward transform. The codebase precedent (model-registry UUIDs) is well-established. No cross-module or architectural concerns requiring formal multi-stage review.
