# Plan

## Plan Audit Cycles
- Audits: none — Plan Auditor v1.9.1
- Architectural Reviews: none — Plan Architect Reviewer v2.3.1

## Prior Project Context
The `2026-08-28-pretty-project-titles` plan delivered end-to-end support for agent-curated `title` fields, mirroring the established `project_summary` pattern. Its synthesis identified four actionable follow-up items (items 2–5) concerning title resilience, input validation hardening, test hygiene, and documentation. This rework plan addresses the three code-level items; persona adjustments are excluded per user request and will be handled separately at branch merge time.

A knowledge-base insight (origin: same plan) confirms that the `project_summary` pattern is the canonical template for agent-curated metadata fields — this rework closes the remaining gaps where `title` deviates from that template.

## Summary
Close the implementation gaps identified in the `2026-08-28-pretty-project-titles` synthesis: (1) store `title` in the root index alongside `.meta.json` for enrichment-failure resilience, (2) add `.trim().min(1)` validation to `title` and `project_summary` input schemas to reject whitespace-only strings, (3) replace inline schema mirrors in tests with real schema imports, and (4) add missing `initializeProject` title integration tests.

## Architectural Context
The MCP server stores project state in two files per project:
- **Root index** (`.ledger/project-ledger.json`) — the authoritative project state, written via `LedgerStore.writeRootIndex()`.
- **Meta cache** (`.meta.json`) — an enrichment cache auto-synced from the root index by `writeRootIndex()`, plus additional fields set via `writeProjectMeta()` or `updateTitle()`.

`project_summary` is stored in both files: spread into the root index object in `initializeProject()` and in `importStandaloneProject()`, then auto-synced to `.meta.json` via `writeRootIndex()`. `title` currently only reaches `.meta.json` — via `writeProjectMeta()` cacheUpdates in `initializeProject()` or `updateTitle()` in `importStandaloneProject()` — making it vulnerable to non-fatal enrichment failures in `initializeProject()`.

Input schemas (`InitializeProjectSchema`, `ImportStandaloneSchema`) use `z.string().min(1)` to reject empty strings but do not call `.trim()`, allowing whitespace-only strings like `"   "` to pass validation.

## Approach / Architecture
1. **Add `title` to `RootIndexSchema`** with the same shape as `project_summary` (`z.string().nullable().optional()`), then thread it through `initializeProject()` (spread into root index object) and `importStandaloneProject()` (spread into root index object). The `writeRootIndex()` auto-sync already propagates all root index fields to `.meta.json` — no new sync code needed. For `importStandaloneProject()`, remove the separate `updateTitle()` call (no longer needed since the root index write handles it).
2. **Add `.trim()` to input schemas** for both `title` and `project_summary` in `InitializeProjectSchema` and `ImportStandaloneSchema`. This closes the whitespace-only string gap flagged by QA.
3. **Fix test hygiene** by replacing inline `z.object` mirrors with imports of the real schemas, and adding the missing `initializeProject` title integration tests that parallel the existing `project_summary` tests.

## Rationale
- Storing `title` in the root index mirrors `project_summary`'s dual-path durability pattern exactly, closing the last asymmetry between these two agent-curated fields.
- `.trim()` is safe to add — Zod's `.trim()` is a transform that strips whitespace before downstream validators run, so `z.string().trim().min(1)` rejects `"   "` by trimming it to `""` first. This is a strict tightening of the input contract — no existing valid input becomes invalid.
- Removing the standalone `updateTitle()` call simplifies `importStandaloneProject()` by eliminating the ordering constraint (the comment explains that `updateTitle()` must come after `writeRootIndex()` because it reads the `.meta.json` that `writeRootIndex()` creates). With `title` on the root index, `writeRootIndex()` auto-syncs it to `.meta.json` in one step.

## Considered Alternatives

| Decision | Chosen Shape | Alternatives Considered | Trade-Off Summary |
|----------|--------------|-------------------------|-------------------|
| Title in root index vs. meta-only | Store `title` in root index + auto-sync to `.meta.json` | Keep title in `.meta.json` only (status quo) | Dual-path mirrors `project_summary` exactly, survives enrichment failures, removes the `updateTitle()` ordering constraint in `importStandaloneProject()`. The minor cost is one extra optional field in the root index schema. |
| `.trim()` on input schemas vs. storage schemas | Apply `.trim()` to input schemas only | Apply `.trim()` to storage schemas too; or add a manual `.refine()` check | Input-only `.trim()` is the narrowest safe change — it normalizes incoming data without altering how stored data is parsed. A storage-schema `.trim()` would silently mutate existing data on read, which is harmless for these fields but sets a precedent we don't need. |
| Remove `updateTitle()` from `importStandaloneProject` | Yes — title on root index makes it redundant for import | Keep both paths (root index + `updateTitle()`) | Removing the standalone call simplifies the method and eliminates the documented ordering constraint. `updateTitle()` itself is still needed for the GUI rename flow (`handleRenameProject`) — only its use in `importStandaloneProject` is removed. |

## Pattern Alignment
- **Dual-path field storage** (`project_summary` pattern) — `mcp-server/src/tools/project-lifecycle.ts` (L674), `mcp-server/src/storage/ledger-store.ts` (L824). This plan follows this pattern by adding `title` to the root index.
- **Input schema validation** — all `InitializeProjectSchema` and `ImportStandaloneSchema` fields. This plan adds `.trim()` to two fields, consistent with the intent of `.min(1)` but currently absent from the codebase. No departure from existing patterns.
- **Test imports of real schemas** — `project-lifecycle.test.ts` (L2098–L2121) imports `InitializeProjectSchema` for `project_summary` tests. This plan extends that pattern to `title` tests and fixes the `standalone-import.test.ts` tests that deviate from it.

## Structural Improvements

| Structure | Observation | Decision | Reason |
|-----------|-------------|----------|--------|
| `mcp-server/src/storage/ledger-store.ts` `importStandaloneProject()` | The `updateTitle()` call after `writeRootIndex()` exists only because `title` is not on the root index. With `title` added to the root index, this separate call becomes redundant. | Promoted to step 3 | Removing it simplifies the method and eliminates the ordering constraint documented in the inline comment. |
| `mcp-server/src/storage/ledger-store.ts` `writeRootIndex()` auto-sync block | Currently propagates `outcome_summary` and `project_summary` from the root index to `.meta.json` cacheUpdates. Does not propagate `title`. | Promoted to step 2 | Adding `title` to the auto-sync block is required for the dual-path storage to work correctly. |
| `mcp-server/src/storage/ledger-store.ts` `MetaCacheUpdates.title` JSDoc | Documents that `importStandaloneProject` calls `updateTitle()` directly — this will become outdated after step 3. | Promoted to step 3 | The JSDoc must be updated to reflect the new flow. |

## Detailed Steps

### Step 1: Add `title` to `RootIndexSchema`
- In `mcp-server/src/schema/root-index.ts`, add `title: z.string().nullable().optional()` to `RootIndexSchema`, positioned after `project_summary` for logical grouping.

### Step 2: Thread `title` through `writeRootIndex()` auto-sync
- In `mcp-server/src/storage/ledger-store.ts`, in the `writeRootIndex()` method's auto-sync block (around L305–L310), add a line to propagate `validated.title` from the root index to the `.meta.json` cacheUpdates, following the same `'key' in validated` pattern used for `outcome_summary` and `project_summary`. Since `title` is non-nullable in `MetaCacheUpdates` (uses `!== undefined` semantics), use `validated.title !== undefined` rather than `'title' in validated`.

### Step 3: Spread `title` into the root index in `initializeProject()`
- In `mcp-server/src/tools/project-lifecycle.ts`, in the `initializeProject()` function, add `title` to the root index object spread (around L674), following the same conditional pattern as `project_summary`: `...(args.title !== undefined ? { title: args.title } : {})`.

### Step 4: Spread `title` into the root index in `importStandaloneProject()` and remove `updateTitle()` call
- In `mcp-server/src/storage/ledger-store.ts`, in `importStandaloneProject()`:
  - Add `...(detail.title !== undefined ? { title: detail.title } : {})` to the root index object (around L824, after the `project_summary` spread).
  - Remove the `if (detail.title !== undefined) { await this.updateTitle(detail.title); }` block (around L851–L853) and its preceding comment. The `writeRootIndex()` auto-sync now handles `.meta.json` propagation.

### Step 5: Update `MetaCacheUpdates.title` JSDoc
- In `mcp-server/src/storage/ledger-store.ts`, update the JSDoc for `MetaCacheUpdates.title` (around L33–L37) to reflect that `importStandaloneProject()` now threads `title` through the root index instead of calling `updateTitle()` directly. Also update the `writeProjectMeta()` `@param cacheUpdates` JSDoc (around L541) to remove the note about `importStandaloneProject` calling `updateTitle()` directly.

### Step 6: Add `.trim()` to `title` and `project_summary` in input schemas
- In `mcp-server/src/tools/project-lifecycle.ts`, change `InitializeProjectSchema`:
  - `project_summary`: `z.string().min(1).optional()` → `z.string().trim().min(1).optional()`
  - `title`: `z.string().min(1).max(200).optional()` → `z.string().trim().min(1).max(200).optional()`
- In `mcp-server/src/tools/standalone-import.ts`, change `ImportStandaloneSchema`:
  - `project_summary`: `z.string().min(1).optional()` → `z.string().trim().min(1).optional()`
  - `title`: `z.string().min(1).max(200).optional()` → `z.string().trim().min(1).max(200).optional()`

### Step 7: Fix schema boundary tests in `standalone-import.test.ts`
- Replace the two inline `z.object` mirror tests (`rejects an empty string for title`, `rejects a title exceeding 200 characters`) with tests that import the real `ImportStandaloneSchema` (via a dynamic import or test-level import). The tests should validate the same constraints but against the actual schema, so that future constraint changes are caught.

### Step 8: Add `initializeProject` title integration tests
- In `mcp-server/tests/tools/project-lifecycle.test.ts`, add a new `describe('initializeProject — title parameter')` block after the existing `project_summary` tests (at the end of the file). The tests should parallel the existing `project_summary` tests:
  - Schema accepts a valid `title` string (against `InitializeProjectSchema`)
  - Schema accepts objects without `title`
  - Schema rejects an empty `title` string
  - Schema rejects a `title` exceeding 200 characters
  - Schema rejects a whitespace-only `title` string (new — validates the `.trim()` addition)
  - Persists `title` in `project-ledger.json` when provided (integration test)
  - Persists `title` in `.meta.json` when provided (integration test)
  - Omits `title` from `project-ledger.json` when not provided
  - Omits `title` from `.meta.json` when not provided

### Step 9: Add `.trim()` validation tests for `project_summary`
- In the existing `initializeProject — project_summary parameter` describe block, add one test: schema rejects a whitespace-only `project_summary` string (validates the `.trim()` addition).
- In `standalone-import.test.ts`, add similar whitespace-only rejection tests for both `project_summary` and `title` using the real schemas.

### Step 10: Add title resilience test for `initializeProject`
- Add a test verifying that `title` survives even when the `.meta.json` enrichment block throws — i.e., `title` is present in the root index regardless of enrichment success. This can be done by calling `initializeProject()` with a `title`, then reading the root index directly (via `store.readRootIndex()`) and verifying `root.title` is set.

### Step 11: Update AGENTS.md cross-system dependencies
- In the root `AGENTS.md`, update the `project_summary` / `title` cross-system dependency rows to reflect that `title` is now also stored in the root index (`RootIndexSchema.title`), not only in `.meta.json`.

## Dependencies
- Steps 1–2 must be completed before steps 3–4 (the root index schema must accept `title` before it can be spread into root index objects).
- Step 6 must be completed before steps 7–9 (test assertions depend on the `.trim()` transform being present).
- Steps 3–5 are independent of step 6.
- Steps 7–10 depend on the corresponding code changes in steps 1–6.

## Required Components
- `mcp-server/src/schema/root-index.ts` (existing — modify)
- `mcp-server/src/storage/ledger-store.ts` (existing — modify)
- `mcp-server/src/tools/project-lifecycle.ts` (existing — modify)
- `mcp-server/src/tools/standalone-import.ts` (existing — modify)
- `mcp-server/tests/tools/project-lifecycle.test.ts` (existing — modify)
- `mcp-server/tests/tools/standalone-import.test.ts` (existing — modify)
- `AGENTS.md` (existing — modify)

## Assumptions
- The `.trim()` Zod transform is safe to add to input schemas because no existing valid input (non-whitespace string of length ≥ 1) becomes invalid after trimming.
- Existing stored data with leading/trailing whitespace in `title` or `project_summary` fields is acceptable to leave as-is (no migration needed) since the storage schemas are not modified with `.trim()`.
- The `updateTitle()` method on `LedgerStore` remains needed for the GUI rename flow (`handleRenameProject`) — only its use in `importStandaloneProject` is removed.

## Constraints
- Persona source files are explicitly excluded from this rework per user request.
- Storage schemas (`ProjectMetaSchema`, `RootIndexSchema`) do not get `.trim()` — only input schemas.
- No new test patterns are introduced — all new tests follow existing conventions in their respective test files.

## Out of Scope
- Persona file updates (ledger-bootstrapper, standalone-archiver, title-crafting-guide) — handled by user at branch merge time.
- Extending the agent-curated field pattern to new fields (`tags`, `category`) — future plan.
- `CONTRIBUTING.md` section on cacheable field semantics (synthesis follow-up item 5) — low priority, deferred.
- GUI end-to-end integration test crossing tool→GUI layer boundaries — not a current test pattern in this codebase.

## Acceptance Criteria
- AC-01: `RootIndexSchema` includes `title: z.string().nullable().optional()`.
- AC-02: `writeRootIndex()` auto-sync propagates `title` from the root index to `.meta.json`.
- AC-03: `initializeProject()` spreads `title` into the root index object (not only `.meta.json` enrichment).
- AC-04: `importStandaloneProject()` spreads `title` into the root index object and no longer calls `updateTitle()` separately.
- AC-05: `InitializeProjectSchema.project_summary` uses `.trim().min(1)`.
- AC-06: `InitializeProjectSchema.title` uses `.trim().min(1).max(200)`.
- AC-07: `ImportStandaloneSchema.project_summary` uses `.trim().min(1)`.
- AC-08: `ImportStandaloneSchema.title` uses `.trim().min(1).max(200)`.
- AC-09: Schema boundary tests in `standalone-import.test.ts` import the real `ImportStandaloneSchema` instead of inline mirrors.
- AC-10: `project-lifecycle.test.ts` includes title integration tests parallel to `project_summary` tests.
- AC-11: Whitespace-only string rejection tests exist for both `title` and `project_summary` in both tool test files.
- AC-12: A resilience test verifies `title` is present in the root index after `initializeProject()`.
- AC-13: All existing tests pass (4,089+ tests, 0 failures).
- AC-14: `AGENTS.md` cross-system dependency table reflects `title` in root index.

## Testing Strategy
All changes are covered by unit and integration tests within the existing Vitest test suite. Schema boundary tests validate the Zod transforms at the schema layer. Integration tests validate the end-to-end storage path (tool call → root index read → `.meta.json` read). No new test patterns are introduced.

## Test Plan
- `mcp-server/tests/tools/standalone-import.test.ts` — Replace inline `z.object` mirrors with `ImportStandaloneSchema` imports in existing title schema tests — AC-09
- `mcp-server/tests/tools/standalone-import.test.ts` — Add whitespace-only rejection tests for `title` and `project_summary` — AC-11
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add `describe('initializeProject — title parameter')` with schema, integration, and omission tests — AC-10
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add whitespace-only `project_summary` rejection test — AC-11
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add whitespace-only `title` rejection test — AC-11
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add `title` resilience test (present in root index after `initializeProject()`) — AC-12
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add `title` in root index persistence test — AC-03
- `mcp-server/tests/tools/project-lifecycle.test.ts` — Add `title` in `.meta.json` persistence test — AC-03
- Existing test suite — Full run to confirm no regressions — AC-13

## Documentation Updates
- `AGENTS.md` (root) — Update the `title` row in the Cross-System Dependencies table to add `RootIndexSchema.title` alongside the existing `ProjectMetaSchema.title` reference. Update the `project_summary` field row to note that both fields now share identical dual-path storage. — AC-14
- `CLAUDE.md` (root) — Auto-generated from `AGENTS.md` via `node scripts/cli.js ctx-generate` — will pick up the change automatically on next regeneration.

## Deferred Items

| # | Deferred Item | Origin | Reason Deferred | Notes |
|---|---------------|--------|-----------------|-------|
| 1 | CONTRIBUTING.md section on cacheable field semantics (`!== undefined` vs. `'key' in`) | Synthesis follow-up item 5 | Low priority; the JSDoc on `MetaCacheUpdates.title` already documents this for contributors reading the source. A standalone doc section is a nice-to-have but not worth a plan step. | Reconsider when a CONTRIBUTING.md is created for other reasons. |
| 2 | GUI end-to-end round-trip test (tool call → GUI read) | Synthesis Next Steps item 4 | Not a current test pattern — tools and GUI are tested at their respective layers. Adding a cross-layer test requires establishing a new convention. | Reconsider when the test suite introduces integration testing across layers. |
| 3 | Extend pattern to `tags`, `category` fields | Synthesis Next Steps item 5 | Too broad for a rework scope — requires its own feature plan. | Ready to plan when the GUI design for these fields is settled. |

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Adding `title` to root index breaks existing root index parsing** | `z.string().nullable().optional()` is backward-compatible — existing root index files without `title` parse correctly. |
| **`.trim()` transform breaks existing tool callers** | `.trim()` only affects whitespace-only strings (which were previously accepted but meaningless). No legitimate caller sends whitespace-only titles or summaries. |
| **Removing `updateTitle()` from `importStandaloneProject` breaks title storage** | The `writeRootIndex()` auto-sync now handles the propagation. The resilience test (AC-12) and the existing import tests (which already verify `meta.title` is set) will catch any regression. |

## Recommended Workflow
- **Workflow:** standalone
- **Rationale:** Single-module changes within the MCP server, all following well-understood patterns (the `project_summary` dual-path template), with a small blast radius and no cross-project concerns.
